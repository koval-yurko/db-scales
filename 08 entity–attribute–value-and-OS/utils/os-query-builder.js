// Builds an OpenSearch query body for GET /api/products from the SAME query-param
// contract as `07`'s SQL query-builder — so the two projects are directly
// comparable. Where `07` emitted one self-join per attribute predicate, here each
// predicate is one `filter` clause in a single `bool` query (§6). Adds facets
// (aggregations) and full-text, which EAV-in-SQL cannot do cheaply.

const OPS = ['gte', 'lte', 'gt', 'lt', 'in']; // longest-first so 'gte' wins over 'gt'
const RANGE_OPS = new Set(['gte', 'lte', 'gt', 'lt']);

function coerce(type, raw) {
  if (type === 'number') {
    const n = Number(raw);
    if (Number.isNaN(n)) throw badRequest(`Expected a number, got '${raw}'`);
    return n;
  }
  if (type === 'bool') return raw === true || raw === 'true' || raw === '1';
  return String(raw); // text, date (YYYY-MM-DD)
}

// f_ram_gb_gte -> { code:'ram_gb', op:'gte' } ; f_color -> { code:'color', op:'eq' }
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

const PRICE_OPS = { price_lt: 'lt', price_lte: 'lte', price_gt: 'gt', price_gte: 'gte' };

// The document field an attribute maps to.
const attrField = (code) => `attr.${code}`;

/**
 * @param params      Express req.query
 * @param metaByCode  { code -> { id, data_type, is_filterable, is_sortable } }
 * @returns { body, from, size, page, limit, filters }
 */
function buildProductQuery(params, metaByCode) {
  const filter = [];   // AND-combined, non-scoring (cached bitsets)
  const must = [];      // scoring clauses (full-text)
  const filters = [];   // response echo

  // Category.
  if (params.category) {
    filter.push({ term: { category: params.category } });
  }

  // Full-text (new capability): name + text-attribute .text sub-fields.
  if (params.q && String(params.q).trim() !== '') {
    const fields = ['name^2', 'name.raw'];
    for (const [code, m] of Object.entries(metaByCode)) {
      if (m.data_type === 'text') fields.push(`${attrField(code)}.text`);
    }
    must.push({ multi_match: { query: String(params.q), fields, operator: 'and' } });
    filters.push({ field: '_text', op: 'match', value: params.q });
  }

  // Price (relational field on the document, special-cased like in `07`).
  const priceRange = {};
  for (const [key, esOp] of Object.entries(PRICE_OPS)) {
    if (params[key] !== undefined && params[key] !== '') {
      const n = Number(params[key]);
      if (Number.isNaN(n)) throw badRequest(`${key} must be a number`);
      priceRange[esOp] = n;
      filters.push({ field: 'price', op: key.slice(6), value: n });
    }
  }
  if (Object.keys(priceRange).length) filter.push({ range: { price: priceRange } });

  // EAV attribute filters -> one filter clause each (no joins).
  for (const key of Object.keys(params)) {
    if (!key.startsWith('f_')) continue;
    if (params[key] === '' || params[key] === undefined) continue;

    const { code, op } = parseFilterKey(key, metaByCode);
    const meta = metaByCode[code];
    if (!meta) throw badRequest(`Unknown attribute '${code}'`);
    if (!meta.is_filterable) throw badRequest(`Attribute '${code}' is not filterable`);

    const field = attrField(code);

    if (op === 'in') {
      const arr = String(params[key]).split(',').map((v) => coerce(meta.data_type, v.trim()));
      filter.push({ terms: { [field]: arr } });
    } else if (op === 'eq') {
      filter.push({ term: { [field]: coerce(meta.data_type, params[key]) } });
    } else if (RANGE_OPS.has(op)) {
      if (meta.data_type !== 'number' && meta.data_type !== 'date') {
        throw badRequest(`Op '${op}' only supported on number/date attributes`);
      }
      filter.push({ range: { [field]: { [op]: coerce(meta.data_type, params[key]) } } });
    } else {
      throw badRequest(`Unsupported op '${op}'`);
    }
    filters.push({ field: code, op, value: params[key] });
  }

  // Sort (typed attribute field, or a core field).
  const dir = String(params.dir || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
  let sort = [{ id: 'asc' }];
  if (params.sort) {
    if (params.sort === 'price') {
      sort = [{ price: dir }];
    } else if (params.sort === 'name') {
      sort = [{ 'name.raw': dir }];
    } else if (params.sort === 'sku') {
      sort = [{ sku: dir }];
    } else {
      const meta = metaByCode[params.sort];
      if (!meta) throw badRequest(`Unknown sort attribute '${params.sort}'`);
      if (!meta.is_sortable) throw badRequest(`Attribute '${params.sort}' is not sortable`);
      sort = [{ [attrField(params.sort)]: dir }];
    }
  }

  // Facets / aggregations (new capability): the filter sidebar in one round trip.
  const aggs = {};
  if (params.facets) {
    for (const raw of String(params.facets).split(',')) {
      const code = raw.trim();
      if (!code) continue;
      if (code === 'price') { aggs.price = { stats: { field: 'price' } }; continue; }
      const meta = metaByCode[code];
      if (!meta || !meta.is_filterable) continue; // silently skip unknown facets
      if (meta.data_type === 'number') {
        aggs[code] = { stats: { field: attrField(code) } };
      } else { // text / bool -> term buckets with counts
        aggs[code] = { terms: { field: attrField(code), size: 50 } };
      }
    }
  }

  // Pagination.
  const limit = Math.min(Math.max(parseInt(params.limit) || 20, 1), 200);
  const page = Math.max(parseInt(params.page) || 1, 1);
  const from = (page - 1) * limit;

  const body = {
    track_total_hits: true,
    query: { bool: { filter, ...(must.length ? { must } : {}) } },
    sort,
    from,
    size: limit,
  };
  if (Object.keys(aggs).length) body.aggs = aggs;

  return { body, from, size: limit, page, limit, filters };
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

module.exports = { buildProductQuery, badRequest };
