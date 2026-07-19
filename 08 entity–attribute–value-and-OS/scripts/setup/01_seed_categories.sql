-- Seed the 3 categories, the attribute metadata, and the category→attribute map.
-- Products themselves are generated in JS (setup-database.js / seed.js).
-- Identical to project `07` so the two demos are directly comparable.

INSERT INTO categories (code, label) VALUES
  ('books',   'Books'),
  ('tshirts', 'T-Shirts'),
  ('laptops', 'Laptops');

INSERT INTO attributes (code, label, data_type, unit, is_filterable, is_sortable) VALUES
  -- Books
  ('author',      'Author',      'text',   NULL,    true,  true),
  ('pages',       'Pages',       'number', 'pages', true,  true),
  ('isbn',        'ISBN',        'text',   NULL,    true,  false),
  ('published',   'Published',   'date',   NULL,    true,  true),
  -- T-shirts
  ('size',        'Size',        'text',   NULL,    true,  true),
  ('color',       'Color',       'text',   NULL,    true,  true),
  ('material',    'Material',    'text',   NULL,    true,  false),
  ('organic',     'Organic',     'bool',   NULL,    true,  false),
  -- Laptops
  ('cpu',         'CPU',         'text',   NULL,    true,  false),
  ('ram_gb',      'RAM',         'number', 'GB',    true,  true),
  ('tdp_w',       'TDP',         'number', 'W',     true,  true),
  ('touchscreen', 'Touchscreen', 'bool',   NULL,    true,  false);

INSERT INTO category_attributes (category_id, attribute_id, is_required)
SELECT c.id, a.id, true
FROM categories c
JOIN attributes a ON
     (c.code = 'books'   AND a.code IN ('author','pages','isbn','published'))
  OR (c.code = 'tshirts' AND a.code IN ('size','color','material','organic'))
  OR (c.code = 'laptops' AND a.code IN ('cpu','ram_gb','tdp_w','touchscreen'));
