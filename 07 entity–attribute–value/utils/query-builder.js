// Builds the dynamic filter/sort SQL for GET /api/products from query params +
// attribute metadata. Every attribute predicate becomes ONE self-join on
// product_attribute_values — this is deliberately the "classic EAV" shape so
// the join fan-out is visible.

const OPS = ['gte', 'lte', 'gt', 'lt', 'in']; // longest-first so 'gte' wins over 'gt'
const OP_SQL = { eq: '=', gte: '>=', lte: '<=', gt: '>', lt: '<' };

const COLUMN_BY_TYPE = {
  text: 'value_text',
  number: 'value_number',
  bool: 'value_bool',
  date: 'value_date',
};

function coerce(type, raw) {
  if (type === 'number') {
    const n = Number(raw);
    if (Number.isNaN(n)) throw new Error(`Expected a number, got '${raw}'`);
    return n;
  }
  if (type === 'bool') return raw === true || raw === 'true' || raw === '1';
  return String(raw); // text, date (as YYYY-MM-DD string)
}

// f_ram_gb_gte -> { code: 'ram_gb', op: 'gte' } ; f_color -> { code:'color', op:'eq' }
function parseFilterKey(key, metaByCode) {
  const rest = key.slice(2);
  for (const op of OPS) {
    if (rest.endsWith('_' + op)) {
      const code = rest.slice(0, rest.length - op.length - 1);
      if (metaByCode[code]) return { code, op };
    }
  }
  return { code: rest, op: 'eq' };
}

const PRICE_OPS = { price_lt: '<', price_lte: '<=', price_gt: '>', price_gte: '>=' };

/**
 * @param params    Express req.query
 * @param metaByCode  { code -> { id, data_type, is_filterable, is_sortable } }
 * @returns { sql, countSql, values, filters }
 */
function buildProductQuery(params, metaByCode) {
  const values = [];
  const joins = [];
  const where = [];
  const filters = []; // for the response echo

  const add = (v) => { values.push(v); return `$${values.length}`; };

  // Category (relational).
  if (params.category) {
    where.push(`cat.code = ${add(params.category)}`);
  }

  // Price (relational, special-cased — never an EAV attribute).
  for (const [key, sql] of Object.entries(PRICE_OPS)) {
    if (params[key] !== undefined && params[key] !== '') {
      const n = Number(params[key]);
      if (Number.isNaN(n)) throw badRequest(`${key} must be a number`);
      where.push(`p.price ${sql} ${add(n)}`);
      filters.push({ field: 'price', op: key.slice(6), value: n });
    }
  }

  // EAV attribute filters -> one self-join each.
  let ji = 0;
  for (const key of Object.keys(params)) {
    if (!key.startsWith('f_')) continue;
    if (params[key] === '' || params[key] === undefined) continue;

    const { code, op } = parseFilterKey(key, metaByCode);
    const meta = metaByCode[code];
    if (!meta) throw badRequest(`Unknown attribute '${code}'`);
    if (!meta.is_filterable) throw badRequest(`Attribute '${code}' is not filterable`);

    const col = COLUMN_BY_TYPE[meta.data_type];
    const alias = `f${ji++}`;
    const attrIdParam = add(meta.id);

    let predicate;
    if (op === 'in') {
      const arr = String(params[key]).split(',').map((v) => coerce(meta.data_type, v.trim()));
      predicate = `${alias}.${col} = ANY(${add(arr)})`;
    } else {
      const sqlOp = OP_SQL[op];
      if (!sqlOp) throw badRequest(`Unsupported op '${op}'`);
      if (op !== 'eq' && meta.data_type !== 'number' && meta.data_type !== 'date') {
        throw badRequest(`Op '${op}' only supported on number/date attributes`);
      }
      predicate = `${alias}.${col} ${sqlOp} ${add(coerce(meta.data_type, params[key]))}`;
    }

    joins.push(
      `JOIN product_attribute_values ${alias} ` +
      `ON ${alias}.product_id = p.id AND ${alias}.attribute_id = ${attrIdParam} AND ${predicate}`
    );
    filters.push({ field: code, op, value: params[key] });
  }

  // Sort (typed attribute or price).
  let orderBy = 'p.id';
  const dir = String(params.dir || 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  if (params.sort) {
    if (params.sort === 'price') {
      orderBy = 'p.price';
    } else if (params.sort === 'name' || params.sort === 'sku') {
      orderBy = `p.${params.sort}`;
    } else {
      const meta = metaByCode[params.sort];
      if (!meta) throw badRequest(`Unknown sort attribute '${params.sort}'`);
      if (!meta.is_sortable) throw badRequest(`Attribute '${params.sort}' is not sortable`);
      const col = COLUMN_BY_TYPE[meta.data_type];
      const attrIdParam = add(meta.id);
      joins.push(
        `LEFT JOIN product_attribute_values srt ` +
        `ON srt.product_id = p.id AND srt.attribute_id = ${attrIdParam}`
      );
      orderBy = `srt.${col}`;
    }
  }

  const whereSql = where.length ? `WHERE ${where.join('\n  AND ')}` : '';
  const base =
    `FROM products p\n` +
    `JOIN categories cat ON cat.id = p.category_id\n` +
    (joins.length ? joins.join('\n') + '\n' : '') +
    (whereSql ? whereSql + '\n' : '');

  const countSql = `SELECT COUNT(*)::int AS total\n${base}`;
  const countValues = values.slice(); // shared params only — no limit/offset

  // Pagination.
  const limit = Math.min(Math.max(parseInt(params.limit) || 20, 1), 200);
  const page = Math.max(parseInt(params.page) || 1, 1);
  const offset = (page - 1) * limit;

  const sql =
    `SELECT p.id, p.sku, p.name, p.price::float8 AS price, cat.code AS category\n` +
    base +
    `ORDER BY ${orderBy} ${dir} NULLS LAST\n` +
    `LIMIT ${add(limit)} OFFSET ${add(offset)}`;

  return { sql, countSql, values, countValues, filters, page, limit };
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

module.exports = { buildProductQuery, badRequest };
