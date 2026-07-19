// Turns PostgreSQL (the source of truth) into OpenSearch documents.
// The EAV rows are pivoted into a flat `attr` object HERE, once on write —
// which is exactly the reconstruction cost `07` paid on every read query.
//
// Shared by both sync.js (incremental, driven by the outbox) and reindex.js
// (full backfill). Documents are keyed by product id so all index ops are
// idempotent upserts — safe to replay after a crash (at-least-once delivery).

const { query } = require('./sql-runner');
const { getClient, INDEX } = require('./os-client');

// SELECT that pivots a set of products (EAV rows -> jsonb attr object), typed
// via to_jsonb so numbers stay numbers, bools stay bools, dates -> 'YYYY-MM-DD'.
const PIVOT_SELECT = `
  SELECT p.id, p.sku, p.name, p.price::float8 AS price,
         cat.code AS category, p.created_at,
         COALESCE(
           jsonb_object_agg(a.code,
             CASE a.data_type
               WHEN 'text'   THEN to_jsonb(pav.value_text)
               WHEN 'number' THEN to_jsonb(pav.value_number::float8)
               WHEN 'bool'   THEN to_jsonb(pav.value_bool)
               WHEN 'date'   THEN to_jsonb(pav.value_date)
             END
           ) FILTER (WHERE a.code IS NOT NULL),
           '{}'::jsonb
         ) AS attr
  FROM products p
  JOIN categories cat ON cat.id = p.category_id
  LEFT JOIN product_attribute_values pav ON pav.product_id = p.id
  LEFT JOIN attributes a ON a.id = pav.attribute_id
`;

function rowToDoc(r) {
  return {
    id: Number(r.id),
    sku: r.sku,
    name: r.name,
    category: r.category,
    price: r.price,
    created_at: r.created_at,
    attr: r.attr,
  };
}

// Build documents for a specific set of product ids (used by the sync worker).
async function docsForIds(ids) {
  if (!ids.length) return [];
  const { rows } = await query(
    `${PIVOT_SELECT} WHERE p.id = ANY($1) GROUP BY p.id, cat.code`,
    [ids]
  );
  return rows.map(rowToDoc);
}

// Page through the whole catalog by id (used by the backfill). Returns a page of
// docs with id > afterId, ascending, up to `limit`.
async function docsPage(afterId, limit) {
  const { rows } = await query(
    `${PIVOT_SELECT} WHERE p.id > $1 GROUP BY p.id, cat.code ORDER BY p.id LIMIT $2`,
    [afterId, limit]
  );
  return rows.map(rowToDoc);
}

// Bulk index a set of documents (index = create-or-replace by _id).
async function bulkIndex(docs) {
  if (!docs.length) return { indexed: 0 };
  const body = [];
  for (const doc of docs) {
    body.push({ index: { _index: INDEX, _id: String(doc.id) } });
    body.push(doc);
  }
  const { body: res } = await getClient().bulk({ refresh: false, body });
  if (res.errors) {
    const firstErr = res.items.find((i) => i.index && i.index.error);
    throw new Error(`Bulk index had errors: ${JSON.stringify(firstErr && firstErr.index.error)}`);
  }
  return { indexed: docs.length };
}

// Bulk delete by id (ignores not-found — the doc may never have been indexed).
async function bulkDelete(ids) {
  if (!ids.length) return { deleted: 0 };
  const body = [];
  for (const id of ids) body.push({ delete: { _index: INDEX, _id: String(id) } });
  await getClient().bulk({ refresh: false, body });
  return { deleted: ids.length };
}

module.exports = { docsForIds, docsPage, bulkIndex, bulkDelete, rowToDoc };
