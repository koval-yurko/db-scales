-- Reconstruct "wide" rows: pivot the EAV rows back into one object per product.
-- This is the read-model reconstruction cost — every listing/detail view pays it.
SELECT p.id, p.name, p.price,
  jsonb_object_agg(a.code,
    CASE a.data_type
      WHEN 'text'   THEN to_jsonb(pav.value_text)
      WHEN 'number' THEN to_jsonb(pav.value_number)
      WHEN 'bool'   THEN to_jsonb(pav.value_bool)
      WHEN 'date'   THEN to_jsonb(pav.value_date)
    END
  ) AS attributes
FROM products p
JOIN product_attribute_values pav ON pav.product_id = p.id
JOIN attributes a ON a.id = pav.attribute_id
WHERE p.category_id = (SELECT id FROM categories WHERE code = 'laptops')
GROUP BY p.id
LIMIT 20;
