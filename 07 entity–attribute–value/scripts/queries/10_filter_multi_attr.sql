-- Multi-attribute filter: "red AND size M AND price < 100" (t-shirts).
-- The classic EAV shape: one self-join of the value table per attribute
-- predicate, plus the relational price filter.
SELECT p.id, p.name, p.price
FROM products p
JOIN product_attribute_values c
      ON c.product_id   = p.id
     AND c.attribute_id = (SELECT id FROM attributes WHERE code = 'color')
     AND c.value_text   = 'red'
JOIN product_attribute_values s
      ON s.product_id   = p.id
     AND s.attribute_id = (SELECT id FROM attributes WHERE code = 'size')
     AND s.value_text   = 'M'
WHERE p.category_id = (SELECT id FROM categories WHERE code = 'tshirts')
  AND p.price < 100
ORDER BY p.price
LIMIT 20;
