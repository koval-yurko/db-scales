// DB read/write operations shared by setup-database.js, seed.js and server.js.
// Keeps all the "route a value into the correct value_* column" logic in one
// place so create/update/seed stay consistent.

const { getPool, query } = require('./sql-runner');

const COLUMN_BY_TYPE = {
  text: 'value_text',
  number: 'value_number',
  bool: 'value_bool',
  date: 'value_date',
};

function coerce(type, value) {
  if (type === 'number') {
    const n = Number(value);
    if (Number.isNaN(n)) throw badRequest(`Expected number, got '${value}'`);
    return n;
  }
  if (type === 'bool') return value === true || value === 'true' || value === 1 || value === '1';
  return String(value); // text / date (YYYY-MM-DD)
}

// -> { value_text, value_number, value_bool, value_date } with one non-null.
function typedColumns(type, value) {
  const cols = { value_text: null, value_number: null, value_bool: null, value_date: null };
  cols[COLUMN_BY_TYPE[type]] = coerce(type, value);
  return cols;
}

// ---- metadata ---------------------------------------------------------------

async function loadAttributeMeta() {
  const { rows } = await query(
    `SELECT id, code, data_type, unit, is_filterable, is_sortable FROM attributes`
  );
  const byCode = {};
  for (const r of rows) byCode[r.code] = r;
  return byCode;
}

async function getCategoriesWithAttributes() {
  const { rows } = await query(`
    SELECT c.code, c.label,
      json_agg(json_build_object(
        'code', a.code, 'label', a.label, 'data_type', a.data_type,
        'unit', a.unit, 'is_filterable', a.is_filterable, 'is_sortable', a.is_sortable
      ) ORDER BY a.id) AS attributes
    FROM categories c
    JOIN category_attributes ca ON ca.category_id = c.id
    JOIN attributes a ON a.id = ca.attribute_id
    GROUP BY c.id, c.code, c.label
    ORDER BY c.id
  `);
  return rows;
}

async function getAllAttributes() {
  const { rows } = await query(
    `SELECT code, label, data_type, unit, is_filterable, is_sortable
     FROM attributes ORDER BY id`
  );
  return rows;
}

async function distinctTextValues(code) {
  const { rows } = await query(
    `SELECT DISTINCT pav.value_text AS value
     FROM product_attribute_values pav
     JOIN attributes a ON a.id = pav.attribute_id
     WHERE a.code = $1 AND pav.value_text IS NOT NULL
     ORDER BY 1 LIMIT 500`,
    [code]
  );
  return rows.map((r) => r.value);
}

// Allowed attributes for a category: code -> { id, data_type }.
async function allowedAttributes(categoryCode) {
  const { rows } = await query(`
    SELECT a.id, a.code, a.data_type
    FROM categories c
    JOIN category_attributes ca ON ca.category_id = c.id
    JOIN attributes a ON a.id = ca.attribute_id
    WHERE c.code = $1
  `, [categoryCode]);
  const byCode = {};
  for (const r of rows) byCode[r.code] = r;
  return byCode;
}

// ---- reads ------------------------------------------------------------------

// Reconstruct a single product as a flat object (EAV rows pivoted via jsonb).
async function getProduct(id) {
  const { rows } = await query(`
    SELECT p.id, p.sku, p.name, p.price::float8 AS price, cat.code AS category,
      COALESCE(
        jsonb_object_agg(a.code,
          CASE a.data_type
            WHEN 'text'   THEN to_jsonb(pav.value_text)
            WHEN 'number' THEN to_jsonb(pav.value_number)
            WHEN 'bool'   THEN to_jsonb(pav.value_bool)
            WHEN 'date'   THEN to_jsonb(pav.value_date)
          END
        ) FILTER (WHERE a.code IS NOT NULL),
        '{}'::jsonb
      ) AS attributes
    FROM products p
    JOIN categories cat ON cat.id = p.category_id
    LEFT JOIN product_attribute_values pav ON pav.product_id = p.id
    LEFT JOIN attributes a ON a.id = pav.attribute_id
    WHERE p.id = $1
    GROUP BY p.id, cat.code
  `, [id]);
  return rows[0] || null;
}

// ---- writes -----------------------------------------------------------------

async function createProduct(body) {
  const { sku, name, category, price } = body;
  if (!sku || !name || !category || price === undefined) {
    throw badRequest('sku, name, category and price are required');
  }
  const allowed = await allowedAttributes(category);
  if (Object.keys(allowed).length === 0) throw badRequest(`Unknown category '${category}'`);

  const attrs = body.attributes || {};
  const attrRows = [];
  for (const [code, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === '') continue;
    const meta = allowed[code];
    if (!meta) throw badRequest(`Attribute '${code}' is not valid for category '${category}'`);
    attrRows.push({ id: meta.id, ...typedColumns(meta.data_type, value) });
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO products (sku, name, category_id, price)
       VALUES ($1, $2, (SELECT id FROM categories WHERE code = $3), $4)
       RETURNING id`,
      [sku, name, category, price]
    );
    const productId = rows[0].id;
    for (const a of attrRows) {
      await client.query(
        `INSERT INTO product_attribute_values
           (product_id, attribute_id, value_text, value_number, value_bool, value_date)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [productId, a.id, a.value_text, a.value_number, a.value_bool, a.value_date]
      );
    }
    await client.query('COMMIT');
    return getProduct(productId);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function updateProduct(id, body) {
  const existing = await query(
    `SELECT p.id, cat.code AS category FROM products p
     JOIN categories cat ON cat.id = p.category_id WHERE p.id = $1`,
    [id]
  );
  if (existing.rows.length === 0) return null;
  const category = existing.rows[0].category;
  const allowed = await allowedAttributes(category);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Core fields (partial update).
    const sets = [];
    const vals = [];
    for (const f of ['sku', 'name', 'price']) {
      if (body[f] !== undefined) { vals.push(body[f]); sets.push(`${f} = $${vals.length}`); }
    }
    if (sets.length) {
      vals.push(id);
      await client.query(`UPDATE products SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    }

    // Attribute upserts (leave unmentioned attributes untouched).
    const attrs = body.attributes || {};
    for (const [code, value] of Object.entries(attrs)) {
      const meta = allowed[code];
      if (!meta) throw badRequest(`Attribute '${code}' is not valid for category '${category}'`);
      if (value === null || value === '') {
        await client.query(
          `DELETE FROM product_attribute_values WHERE product_id = $1 AND attribute_id = $2`,
          [id, meta.id]
        );
        continue;
      }
      const c = typedColumns(meta.data_type, value);
      await client.query(
        `INSERT INTO product_attribute_values
           (product_id, attribute_id, value_text, value_number, value_bool, value_date)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (product_id, attribute_id) DO UPDATE SET
           value_text = EXCLUDED.value_text, value_number = EXCLUDED.value_number,
           value_bool = EXCLUDED.value_bool, value_date = EXCLUDED.value_date`,
        [id, meta.id, c.value_text, c.value_number, c.value_bool, c.value_date]
      );
    }

    await client.query('COMMIT');
    return getProduct(id);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// ---- bulk seed --------------------------------------------------------------

// Insert generated products (from data-generator) in chunks. Returns count.
async function insertProductsBatch(products, { chunkSize = 1000, onProgress } = {}) {
  const attrMeta = await loadAttributeMeta(); // code -> { id, data_type }
  const catRows = await query(`SELECT id, code FROM categories`);
  const catId = {};
  for (const r of catRows.rows) catId[r.code] = r.id;

  const client = await getPool().connect();
  let inserted = 0;
  try {
    for (let i = 0; i < products.length; i += chunkSize) {
      const chunk = products.slice(i, i + chunkSize);
      await client.query('BEGIN');

      // Bulk insert products, get ids back keyed by sku.
      const pParams = [];
      const pRows = chunk.map((p, k) => {
        const b = k * 4;
        pParams.push(p.sku, p.name, catId[p.categoryCode], p.price);
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`;
      });
      const { rows: idRows } = await client.query(
        `INSERT INTO products (sku, name, category_id, price)
         VALUES ${pRows.join(', ')} RETURNING id, sku`,
        pParams
      );
      const idBySku = {};
      for (const r of idRows) idBySku[r.sku] = r.id;

      // Bulk insert attribute values.
      const vParams = [];
      const vRows = [];
      for (const p of chunk) {
        const pid = idBySku[p.sku];
        for (const a of p.attrs) {
          const meta = attrMeta[a.code];
          const c = typedColumns(meta.data_type, a.value);
          const b = vParams.length;
          vParams.push(pid, meta.id, c.value_text, c.value_number, c.value_bool, c.value_date);
          vRows.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`);
        }
      }
      if (vRows.length) {
        await client.query(
          `INSERT INTO product_attribute_values
             (product_id, attribute_id, value_text, value_number, value_bool, value_date)
           VALUES ${vRows.join(', ')}`,
          vParams
        );
      }

      await client.query('COMMIT');
      inserted += chunk.length;
      if (onProgress) onProgress(inserted, products.length);
    }
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return inserted;
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

module.exports = {
  loadAttributeMeta, getCategoriesWithAttributes, getAllAttributes,
  distinctTextValues, getProduct, createProduct, updateProduct,
  insertProductsBatch, badRequest,
};
