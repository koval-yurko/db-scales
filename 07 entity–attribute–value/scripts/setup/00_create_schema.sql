-- Classic typed-EAV schema for a web-store product catalog.
-- Idempotent: drops and recreates everything so `npm run setup` is repeatable.

DROP TABLE IF EXISTS product_attribute_values CASCADE;
DROP TABLE IF EXISTS category_attributes       CASCADE;
DROP TABLE IF EXISTS products                  CASCADE;
DROP TABLE IF EXISTS attributes                CASCADE;
DROP TABLE IF EXISTS categories                CASCADE;

-- Categories: small lookup that groups attribute sets.
CREATE TABLE categories (
  id    SERIAL PRIMARY KEY,
  code  TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL
);

-- Attribute metadata: describes each attribute once. Drives which UI
-- filters/sorts are offered and how values are typed.
CREATE TABLE attributes (
  id            SERIAL PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,
  label         TEXT NOT NULL,
  data_type     TEXT NOT NULL CHECK (data_type IN ('text','number','bool','date')),
  unit          TEXT,
  is_filterable BOOLEAN NOT NULL DEFAULT false,
  is_sortable   BOOLEAN NOT NULL DEFAULT false
);

-- Which attributes belong to which category (drives per-category forms/panels).
CREATE TABLE category_attributes (
  category_id  INT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  attribute_id INT NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
  is_required  BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (category_id, attribute_id)
);

-- Products: the Entity. Common/hot columns (price) stay relational; only the
-- variable, category-specific tail goes into EAV.
CREATE TABLE products (
  id          BIGSERIAL PRIMARY KEY,
  sku         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  category_id INT NOT NULL REFERENCES categories(id),
  price       NUMERIC(10,2) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The typed-EAV value table (the EAV core). Separate physical column per data
-- type so range filters / numeric sorts / date comparisons work natively and
-- can use B-tree indexes.
CREATE TABLE product_attribute_values (
  product_id   BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  attribute_id INT    NOT NULL REFERENCES attributes(id),
  value_text   TEXT,
  value_number NUMERIC,
  value_bool   BOOLEAN,
  value_date   DATE,
  PRIMARY KEY (product_id, attribute_id),
  -- Exactly one typed column populated per row.
  CONSTRAINT one_value_per_row
    CHECK (num_nonnulls(value_text, value_number, value_bool, value_date) = 1)
);
