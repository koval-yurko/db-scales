-- Indexing strategy for the EAV value table + the relational pre-filter.
-- Applied after the bulk load so index maintenance doesn't slow the insert.

-- 1. Primary lookup / reconstruction path is the composite PK
--    (product_id, attribute_id) — created with the table, nothing to add here.

-- 2. Filter path: one partial B-tree per typed column, keyed by attribute_id so
--    equality/range predicates on a given attribute are index-driven and the
--    index only stores rows that actually use that type.
CREATE INDEX IF NOT EXISTS idx_pav_attr_text
  ON product_attribute_values (attribute_id, value_text)  WHERE value_text  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pav_attr_number
  ON product_attribute_values (attribute_id, value_number) WHERE value_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pav_attr_bool
  ON product_attribute_values (attribute_id, value_bool)  WHERE value_bool  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pav_attr_date
  ON product_attribute_values (attribute_id, value_date)  WHERE value_date  IS NOT NULL;

-- 3. Relational pre-filter: shrink the product set by category + price before
--    the EAV joins run.
CREATE INDEX IF NOT EXISTS idx_products_cat_price
  ON products (category_id, price);

-- Refresh planner statistics so the demo EXPLAINs reflect the indexes.
ANALYZE product_attribute_values;
ANALYZE products;
