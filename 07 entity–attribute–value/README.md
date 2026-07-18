# PostgreSQL Classic EAV — Web-Store Product Catalog

Demonstrates the **classic typed Entity–Attribute–Value (EAV)** pattern for a
product catalog whose categories have **heterogeneous, category-specific
attributes**, and shows how to support **dynamic filtering and sorting** across
them — the exact use case EAV is reached for, and the exact place it starts to
hurt.

Includes a small **REST API** and a **minimal UI** so you can create/update
products and run dynamic filter/sort queries interactively, plus a
**configurable seeder**.

## Quick start

```bash
npm install
docker-compose up -d        # PostgreSQL on port 5470
npm run setup               # schema + metadata + ~30k products
npm run demo                # run & EXPLAIN the hard queries
npm run api                 # REST API + UI at http://localhost:3070
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run setup` | Create schema, seed 3 categories + attribute metadata, generate ~30k products, build indexes |
| `npm run demo`  | Run the hard queries (multi-attribute filter, typed sort, pivot, breakdown) with timings + `EXPLAIN (ANALYZE, BUFFERS)` |
| `npm run seed`  | CLI batch generation — configurable count + which attributes (see below) |
| `npm run api`   | Start the Express REST API and serve the UI |

## The model

- **`products`** — the Entity. Common/hot columns (`sku`, `name`, `price`) stay
  **relational**; only the variable, category-specific tail goes into EAV.
- **`attributes`** — attribute *metadata* (`code`, `label`, `data_type`, `unit`,
  `is_filterable`, `is_sortable`). Drives which filters/sorts the UI offers.
- **`category_attributes`** — which attributes belong to which category.
- **`product_attribute_values`** — the typed-EAV core: `value_text` /
  `value_number` / `value_bool` / `value_date` (exactly one non-null per row,
  enforced by a `CHECK`). Typed columns keep values native so range filters,
  numeric sorts and date comparisons work and can use B-tree indexes.

Seeded categories & attributes:

| Category  | Attributes |
|-----------|------------|
| Books     | author (text), pages (number), isbn (text), published (date) |
| T-shirts  | size (text), color (text), material (text), organic (bool) |
| Laptops   | cpu (text), ram_gb (number), tdp_w (number), touchscreen (bool) |

## The hard queries (`npm run demo`)

1. **Multi-attribute filter** — `red AND size M AND price < 100`: one self-join
   of the value table per attribute + the relational price filter.
2. **Typed sort** — laptops by `ram_gb` desc (correct numeric order; contrast
   with the lexical `'8' > '64'` trap of stringly-typed EAV).
3. **Pivot wide** — reconstruct products from EAV rows via `jsonb_object_agg`
   (the read-model reconstruction cost).
4. **Breakdown demo** — a 3-attribute filter = 3 self-joins; watch the plan's
   estimated-vs-actual rows diverge.

## REST API

Base URL `http://localhost:3070`.

| Method & path | Purpose |
|---------------|---------|
| `GET /api/categories` | categories, each with its attribute metadata |
| `GET /api/attributes` | full attribute metadata |
| `GET /api/attributes/:code/values` | distinct values for a text attribute (dropdowns) |
| `GET /api/products/:id` | one product, attributes pivoted into a flat object |
| `GET /api/products` | **dynamic filter + sort** (see below) |
| `POST /api/products` | create a product + its attribute values |
| `PUT /api/products/:id` | update core fields and/or attribute values |
| `POST /api/seed` | generate a batch of products from a seed config |

### Dynamic filter + sort

All predicates are **AND-combined**:

```
GET /api/products?category=tshirts&f_color=red&f_size=M&price_lt=100&sort=price&dir=asc
GET /api/products?category=laptops&f_ram_gb_gte=16&f_tdp_w_lte=45&sort=ram_gb&dir=desc
```

- `f_<code>` = equality; `f_<code>_<op>` with `op ∈ {gte,lte,gt,lt,in}`.
  Each maps to **one self-join** on `product_attribute_values`, reading the
  right `value_*` column from the attribute's `data_type`.
- Key parsing strips a known op suffix (`ram_gb_gte` → code `ram_gb`, op `gte`).
- `price` is special-cased (relational): `price_lt/lte/gt/gte`, and `sort=price`.
- Guardrails: only `is_filterable` attributes can be filtered, only
  `is_sortable` can be sorted; codes are validated against the metadata
  whitelist and values are parameterised (injection-safe).
- Add `&explain=1` to get the generated SQL + `EXPLAIN (ANALYZE, BUFFERS)`.
- Response: `{ items, total, page, limit, filters, ms }`.

Example create:

```bash
curl -X POST localhost:3070/api/products -H 'Content-Type: application/json' -d '{
  "sku":"LP-9001","name":"UltraBook 14","category":"laptops","price":1299.00,
  "attributes":{"cpu":"Ryzen 7","ram_gb":32,"tdp_w":28,"touchscreen":true}
}'
```

## Minimal UI

`npm run api` then open `http://localhost:3070`. Three panels, all built from
attribute metadata: **Filter/sort** (with a "show SQL" toggle), **Create/update**
(click a result row to edit it), and **Seed**.

## Configurable seeding

CLI:

```bash
node seed.js --category laptops --count 500
node seed.js --category tshirts --count 1000 --attrs size,color
node seed.js --config seed.config.json
```

`--attrs` whitelists which attributes each product gets (others left absent —
EAV's sparseness on purpose). `--config` loads a full seed config for richer
control:

```json
{
  "category": "laptops",
  "count": 500,
  "attributes": {
    "cpu":         { "enabled": true },
    "ram_gb":      { "enabled": true, "values": [8, 16, 32, 64] },
    "tdp_w":       { "enabled": true, "min": 15, "max": 125 },
    "touchscreen": { "enabled": true, "prob": 0.3 }
  },
  "priceRange": { "min": 300, "max": 3000 }
}
```

The UI's Seed panel and `POST /api/seed` accept the same config object.

## Indexing strategy

Applied in `scripts/setup/02_create_indexes.sql`:

1. **Composite PK `(product_id, attribute_id)`** — reconstruction/pivot path.
2. **Per-type partial B-trees** `(attribute_id, value_*) WHERE value_* IS NOT NULL`
   — the filter path (one per typed column).
3. **`products(category_id, price)`** — relational pre-filter before the joins.

## Where EAV performance breaks down

- **Join fan-out** — N filter attributes ⇒ N self-joins; planner cost grows fast.
- **No cross-attribute statistics** — the optimizer can't see correlations
  between attributes, so cardinality estimates and join ordering degrade on 3+
  predicates (see the breakdown demo).
- **Reconstruction cost** — every listing/detail view pivots many rows into one.
- **Type safety pushed to app/CHECK** — every consumer must know which `value_*`
  column to read; the DB won't enforce per-attribute value domains cheaply.
- **Write amplification** — one logical product = 1 + N row writes.

### When to stop using EAV

| Approach | Good when | Trade-off |
|----------|-----------|-----------|
| **EAV** (this repo) | many categories, open-ended attribute sets, attributes are data | hard multi-attribute filters, poor estimates, reconstruction cost |
| **JSONB column** (+ GIN) | sparse dynamic attributes, mostly whole-document reads/filters | weaker typing/constraints, GIN index tuning |
| **Wide / per-category tables** | few, stable attribute sets | schema churn (DDL) per new attribute; sparse NULLs |
| **Hybrid** | hot columns relational + cold tail in JSONB/EAV | two access patterns to maintain |
