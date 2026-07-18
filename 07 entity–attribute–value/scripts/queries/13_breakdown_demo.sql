-- Where EAV breaks down: a 3-attribute filter = 3 self-joins of the value table.
-- Watch the plan's estimated vs actual rows diverge — the planner has no
-- cross-attribute statistics, so join ordering/cardinality estimates degrade as
-- predicates are added. Each extra filter attribute adds another join like this.
SELECT p.id, p.name, p.price
FROM products p
JOIN product_attribute_values r
      ON r.product_id   = p.id
     AND r.attribute_id = (SELECT id FROM attributes WHERE code = 'ram_gb')
     AND r.value_number >= 16
JOIN product_attribute_values t
      ON t.product_id   = p.id
     AND t.attribute_id = (SELECT id FROM attributes WHERE code = 'tdp_w')
     AND t.value_number < 45
JOIN product_attribute_values u
      ON u.product_id   = p.id
     AND u.attribute_id = (SELECT id FROM attributes WHERE code = 'cpu')
     AND u.value_text IN ('Core i7', 'Ryzen 7', 'M3')
WHERE p.category_id = (SELECT id FROM categories WHERE code = 'laptops')
  AND p.price < 2000
ORDER BY p.price
LIMIT 20;
