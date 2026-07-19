-- PostgreSQL write model — the SOURCE OF TRUTH.
-- Same typed-EAV schema as project `07`, PLUS an `outbox` table that drives the
-- PG -> OpenSearch sync (§5). Idempotent so `npm run setup` is repeatable.

DROP TABLE IF EXISTS outbox                    CASCADE;
DROP TABLE IF EXISTS product_attribute_values  CASCADE;
DROP TABLE IF EXISTS category_attributes        CASCADE;
DROP TABLE IF EXISTS products                   CASCADE;
DROP TABLE IF EXISTS attributes                 CASCADE;
DROP TABLE IF EXISTS categories                 CASCADE;

-- Categories: small lookup that groups attribute sets.
CREATE TABLE categories (
  id    SERIAL PRIMARY KEY,
  code  TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL
);

-- Attribute metadata: describes each attribute once. Drives which UI
-- filters/sorts are offered, how values are typed, AND the OpenSearch mapping.
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

-- The typed-EAV value table (the EAV core). One physical column per data type.
CREATE TABLE product_attribute_values (
  product_id   BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  attribute_id INT    NOT NULL REFERENCES attributes(id),
  value_text   TEXT,
  value_number NUMERIC,
  value_bool   BOOLEAN,
  value_date   DATE,
  PRIMARY KEY (product_id, attribute_id),
  CONSTRAINT one_value_per_row
    CHECK (num_nonnulls(value_text, value_number, value_bool, value_date) = 1)
);

-- Transactional outbox: every write appends one row here IN THE SAME
-- TRANSACTION as the data change (§5.1). The sync worker (sync.js) drains it and
-- pushes documents to OpenSearch, then stamps processed_at. This is what makes
-- the PG -> OpenSearch sync reliable (never lose an update, never index an
-- uncommitted product).
CREATE TABLE outbox (
  id           BIGSERIAL PRIMARY KEY,
  product_id   BIGINT NOT NULL,
  op           TEXT   NOT NULL CHECK (op IN ('upsert','delete')),
  enqueued_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ
);

-- Cheap "give me the next pending batch" scan.
CREATE INDEX idx_outbox_pending ON outbox (id) WHERE processed_at IS NULL;

-- Relational pre-filter for the reindex/backfill read path (paging by category).
CREATE INDEX idx_products_cat ON products (category_id, id);
