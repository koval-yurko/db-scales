// Builds the OpenSearch index mapping from the `attributes` metadata rows, so the
// search-engine field type matches each EAV data_type (§4.2). This is the
// OpenSearch equivalent of `07`'s typed value_* columns: types are declared, not
// guessed, so range filters / numeric sorts / facets all behave correctly.

// EAV data_type -> OpenSearch field definition for an attr.<code> field.
function fieldForType(dataType) {
  switch (dataType) {
    case 'number':
      // double covers ints (ram_gb, pages) and decimals alike; sorts numerically.
      return { type: 'double' };
    case 'bool':
      return { type: 'boolean' };
    case 'date':
      // EAV value_date is serialized as a 'YYYY-MM-DD' JSON string.
      return { type: 'date', format: 'yyyy-MM-dd' };
    case 'text':
    default:
      // keyword: exact filter + term facets + sort.
      // .text sub-field: analyzed, for full-text (multi_match) on attribute values.
      return { type: 'keyword', fields: { text: { type: 'text' } } };
  }
}

/**
 * @param attributeRows  [{ code, data_type }, ...] from the attributes table
 * @returns { settings, mappings } ready for indices.create
 */
function buildIndexBody(attributeRows) {
  const attrProps = {};
  for (const a of attributeRows) {
    attrProps[a.code] = fieldForType(a.data_type);
  }

  return {
    settings: {
      number_of_shards: 1,
      number_of_replicas: 0,
    },
    mappings: {
      // Do not silently create fields for unmapped attrs — types must be explicit.
      dynamic: 'strict',
      properties: {
        id: { type: 'long' },
        sku: { type: 'keyword' },
        // full-text on name, plus name.raw keyword for exact match / sorting.
        name: { type: 'text', fields: { raw: { type: 'keyword' } } },
        category: { type: 'keyword' },
        price: { type: 'double' },
        created_at: { type: 'date' },
        // the denormalized EAV tail, one typed field per attribute code.
        attr: { properties: attrProps },
      },
    },
  };
}

// Which attribute codes are text (used by the query builder to add .text fields
// to full-text search).
function textAttributeCodes(attributeRows) {
  return attributeRows.filter((a) => a.data_type === 'text').map((a) => a.code);
}

module.exports = { buildIndexBody, fieldForType, textAttributeCodes };
