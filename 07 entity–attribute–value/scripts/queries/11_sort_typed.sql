-- Sort on a typed attribute: laptops by RAM (numeric) descending.
-- value_number gives a correct numeric ordering; ORDER BY value_text would sort
-- lexically ('8' > '64' > '32' > '16'), which is the stringly-typed EAV trap.
SELECT p.id, p.name, v.value_number AS ram_gb, p.price
FROM products p
JOIN product_attribute_values v
      ON v.product_id   = p.id
     AND v.attribute_id = (SELECT id FROM attributes WHERE code = 'ram_gb')
WHERE p.category_id = (SELECT id FROM categories WHERE code = 'laptops')
ORDER BY v.value_number DESC
LIMIT 20;
