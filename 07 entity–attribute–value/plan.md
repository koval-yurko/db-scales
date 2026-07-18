# Plan — Classic EAV (Entity–Attribute–Value) for a Web-Store Product Catalog

## Goal

Demonstrate the **Classic typed-EAV pattern** for storing products with
heterogeneous, category-specific attributes, and show how to support **dynamic
filtering and sorting** across those attributes — the exact use case EAV is
reached for and the exact place it starts to hurt.

The project follows the same structure as the sibling projects in this repo
(`05 cqrs`, `06 event-sourcing-and-cqrs`): PostgreSQL in Docker + a small
**plain Node.js** (CommonJS) driver using `pg`, SQL files under `scripts/`, and
a `demonstrate-queries.js` benchmark runner — plus an Express API + minimal UI.

---

## 1. Concept — what we are modelling and why

A web store sells wildly different product types. Each **category** has its own
attribute set:

| Category   | Attributes (code : type)                                            |
|------------|--------------------------------------------------------------------|
| Books      | `author` (text), `pages` (number), `isbn` (text), `published` (date) |
| T-shirts   | `size` (text), `color` (text), `material` (text), `organic` (bool)  |
| Laptops    | `cpu` (text), `ram_gb` (number), `tdp_w` (number), `touchscreen` (bool) |

A single wide `products` table would need a column per attribute → a sparse
table full of `NULL`s that changes shape every time marketing adds a category.
**EAV** instead stores each attribute value as a *row*, so adding an attribute
is data, not DDL.

We use the **typed / "clean" EAV" variant**: separate physical columns per data
type (`value_text`, `value_number`, `value_bool`, `value_date`) instead of one
stringly-typed `value` column. This keeps values in their native type so range
filters (`price < 100`), numeric sorts, and date comparisons work correctly and
can use B-tree indexes.

---

## 2. Schema

### 2.1 `products` — the Entity

Core columns shared by *every* product live here (never in EAV — this is the
standard hybrid rule: common/hot columns stay relational, only the variable
tail goes into EAV).

```sql
products (
  id           BIGSERIAL PRIMARY KEY,
  sku          TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  category_id  INT  NOT NULL REFERENCES categories(id),
  price        NUMERIC(10,2) NOT NULL,   -- common attribute, stays relational
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

`categories (id, code, label)` — small lookup so we can group attribute sets.

### 2.2 `attributes` — the Attribute *metadata* table

Describes each attribute once. Drives which UI filters/sorts are offered.

```sql
attributes (
  id           SERIAL PRIMARY KEY,
  code         TEXT UNIQUE NOT NULL,      -- 'author', 'ram_gb', ...
  label        TEXT NOT NULL,             -- 'Author', 'RAM (GB)'
  data_type    TEXT NOT NULL CHECK (data_type IN ('text','number','bool','date')),
  unit         TEXT,                      -- 'GB', 'W', 'pages', NULL
  is_filterable BOOLEAN NOT NULL DEFAULT false,
  is_sortable   BOOLEAN NOT NULL DEFAULT false
)
```

`category_attributes (category_id, attribute_id, is_required)` join declares
which attributes belong to which category. **Required, not optional** — the API
(`GET /api/categories`), the metadata-driven UI forms, and create/update
validation all depend on this category→attribute mapping.

### 2.3 `product_attribute_values` — the typed Value table (the EAV core)

```sql
product_attribute_values (
  product_id    BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  attribute_id  INT    NOT NULL REFERENCES attributes(id),
  value_text    TEXT,
  value_number  NUMERIC,
  value_bool    BOOLEAN,
  value_date    DATE,
  PRIMARY KEY (product_id, attribute_id),
  -- exactly one typed column populated, matching the attribute's data_type
  CHECK (num_nonnulls(value_text, value_number, value_bool, value_date) = 1)
)
```

The composite PK `(product_id, attribute_id)` enforces "one value per attribute
per product" and gives us the primary lookup index for free.

---

## 3. Seed data

Generated in `utils/data-generator.js`, inserted by `setup-database.js`:

- **3 categories**: books, t-shirts, laptops.
- **Attribute metadata**: the ~12 attributes from the table in §1, with correct
  `data_type`, `unit`, and `is_filterable` / `is_sortable` flags
  (e.g. `isbn` filterable but not sortable; `ram_gb`/`size`/`color` filterable
  **and** sortable). Note `price` is **not** an EAV attribute — it's the
  relational `products.price` column, always filterable/sortable and handled as
  a special case by the API (see §8.2).
- **Products**: default **~30,000** (`SEED_PRODUCTS`) spread across the 3
  categories, each with its full attribute set populated in
  `product_attribute_values` (~4 rows/product → ~120K EAV rows). Scale is
  configurable via `.env` so the "where it breaks" query timings are visible
  but the demo still runs in seconds.
- Realistic value distributions (sizes S/M/L/XL, a color palette, RAM in
  {8,16,32,64}, page counts, ISBNs, publish dates) so filters return sensible
  cardinalities.

> The generator is **configurable** (item count + which attributes each item
> gets) and can be driven from the CLI *and* the UI/API — see §7.

---

## 4. The hard queries (the point of the demo)

`scripts/queries/*.sql`, run + timed by `demonstrate-queries.js`.

### 4.1 Multi-attribute filter — "red AND size M AND price < 100" (t-shirts)

The classic EAV pain: each attribute predicate is a **separate self-join** of
the value table (one join per attribute), plus the relational `price` filter.

```sql
SELECT p.id, p.name, p.price
FROM products p
JOIN product_attribute_values c
     ON c.product_id = p.id AND c.attribute_id = :color_id AND c.value_text = 'red'
JOIN product_attribute_values s
     ON s.product_id = p.id AND s.attribute_id = :size_id  AND s.value_text = 'M'
WHERE p.category_id = :tshirt_cat
  AND p.price < 100;
```

Also show the **EXISTS / semi-join** and **pivot via `FILTER`/`crosstab`**
formulations, and compare plans + timings against the join version.

### 4.2 Sort on a typed attribute — laptops by RAM desc

```sql
SELECT p.id, p.name, v.value_number AS ram_gb
FROM products p
JOIN product_attribute_values v
     ON v.product_id = p.id AND v.attribute_id = :ram_id
WHERE p.category_id = :laptop_cat
ORDER BY v.value_number DESC        -- correct numeric sort, thanks to typed column
LIMIT 20;
```

Contrast with the stringly-typed trap (`ORDER BY value_text` sorts `'100' < '9'`)
to justify the typed-column design.

### 4.3 Pivot to a "wide" row (present a product with all its attributes)

`... aggregate the EAV rows back into one row per product` via
`jsonb_object_agg(code, value)` or conditional `MAX(...) FILTER (WHERE ...)`.
Shows the read-model reconstruction cost.

Each query is run with `EXPLAIN (ANALYZE, BUFFERS)` and wall-clock timing so the
join fan-out cost is concrete.

---

## 5. Indexing strategy

Documented in `scripts/setup/` and in the README, applied then benchmarked:

1. **Composite PK `(product_id, attribute_id)`** — fetch all attributes of one
   product; the reconstruction/pivot path.
2. **`(attribute_id, value_text)`** partial-per-type B-trees — the filter path.
   One index per typed column so equality/range predicates on a given attribute
   are index-driven:
   - `(attribute_id, value_text)  WHERE value_text  IS NOT NULL`
   - `(attribute_id, value_number) WHERE value_number IS NOT NULL`
   - `(attribute_id, value_bool)  WHERE value_bool  IS NOT NULL`
   - `(attribute_id, value_date)  WHERE value_date  IS NOT NULL`
3. **`products(category_id, price)`** — the relational pre-filter that shrinks
   the set before the EAV joins.
4. Show `ANALYZE` + before/after `EXPLAIN` so the indexes' effect is measured,
   not asserted.

---

## 6. Where EAV performance breaks down (notes section)

A dedicated README section + a demo query that makes each point visible:

- **Join fan-out**: N filter attributes ⇒ N self-joins; planner cost and row
  estimates degrade fast, and the optimizer's cardinality estimates on EAV are
  notoriously bad (correlated attributes it can't see).
- **No cross-attribute statistics** → poor join ordering on 3+ predicate
  filters.
- **Reconstruction cost**: showing a product page = pivoting many rows back into
  one; a listing page pivots for every row.
- **Type safety pushed to app/CHECK** instead of the schema; every consumer must
  know which `value_*` column to read.
- **Constraints & FKs on values are awkward** (can't easily say "size ∈ {S,M,L}"
  per attribute without extra tables/triggers).
- **Write amplification**: one logical product = 1 + N row writes.
- **When to stop using EAV** — the alternatives to name: `JSONB` column (GIN
  indexed) for sparse dynamic attributes, per-category tables / class-table
  inheritance, or a hybrid (hot columns relational + cold tail in JSONB/EAV).
  Short comparison table EAV vs JSONB vs wide-table.

---

## 7. Configurable seeding (generate products on demand)

Beyond the fixed initial seed of §3, the generator is **parameterised** so you
can produce arbitrary batches of products and control both **how many** and
**which attributes** each product carries.

### 7.1 Seed configuration shape

A plain config object (defaults in `.env`, overridable per-call via CLI flags or
the API body):

```js
{
  category: 'laptops',        // which category to generate for
  count: 500,                 // how many products to create
  attributes: {               // which attributes to populate + how
    cpu:         { enabled: true },
    ram_gb:      { enabled: true, values: [8, 16, 32, 64] },   // pick from set
    tdp_w:       { enabled: true, min: 15, max: 125 },          // numeric range
    touchscreen: { enabled: true, prob: 0.3 },                  // bool probability
    // omit / enabled:false  → that attribute is left absent for these products
  },
  priceRange: { min: 300, max: 3000 }
}
```

Key behaviours:
- **Sparse by design**: any attribute set to `enabled:false` (or omitted) is
  simply not written — this is exactly what EAV is good at and lets you create
  products with *heterogeneous* attribute coverage on purpose (great for
  demonstrating "filter returns fewer rows because some products lack the attr").
- **Validation**: requested attribute codes are checked against the `attributes`
  metadata for that category; unknown/incompatible codes are rejected.
- **Reusable core**: `utils/data-generator.js` exposes
  `generateProducts(seedConfig)` used by both the initial `setup-database.js`
  and the on-demand seed paths below.

### 7.2 How it's driven

- **CLI**: `node seed.js --category laptops --count 500 --attrs cpu,ram_gb,tdp_w`
  (plus `npm run seed`). A `--config seed.config.json` flag loads the full object
  for richer control (value sets, ranges, probabilities).
- **API**: `POST /api/seed` with the config object as JSON body → returns count
  inserted + timing. Lets the **UI** trigger generation (§9).
- Default `count` / `category` come from `.env` (`SEED_PRODUCTS`,
  `SEED_DEFAULT_CATEGORY`).

---

## 8. Minimal REST API

A small **Express** server (`server.js`, `npm run api`) exposing the catalog.
Keeps the repo's plain-Node/CommonJS convention — just adds `express`. All
dynamic-filter SQL is built the same way as the §4 hard queries (parameterised
self-joins), so the API *is* a live demonstration of EAV querying, not a
separate codebase.

### 8.1 Endpoints

| Method & path            | Purpose                                                        |
|--------------------------|----------------------------------------------------------------|
| `GET  /api/categories`   | list categories, each with its attribute metadata (for the UI) |
| `GET  /api/attributes`   | full attribute metadata (`code,label,data_type,unit,flags`)    |
| `GET  /api/attributes/:code/values` | distinct values for a text attr (dropdowns) |
| `GET  /api/products/:id` | one product, attributes pivoted into a flat object             |
| `GET  /api/products`     | **dynamic filter + sort** (the core query, see §8.2)           |
| `POST /api/products`     | **create** a product + its attribute values                    |
| `PUT  /api/products/:id` | **update** core fields and/or attribute values                 |
| `POST /api/seed`         | generate a batch of products from a seed config (§7)           |

### 8.2 Dynamic filter + sort query params

`GET /api/products` accepts, all **AND-combined**:

```
?category=tshirts
&price_lt=100                    → relational predicate on products.price
&f_color=red                     → EAV equality: color = 'red'
&f_size=M                        → EAV equality: size = 'M'
&f_ram_gb_gte=16                 → EAV range on a numeric attribute
&sort=ram_gb&dir=desc            → sort on a typed attribute (value_number)
&page=1&limit=20
```

- Each `f_<code>` / `f_<code>_<op>` maps to **one self-join** on
  `product_attribute_values` filtered by that attribute's id, reading the
  correct `value_*` column based on the attribute's `data_type`.
- **Key parsing**: attribute codes contain underscores (`ram_gb`), so the parser
  strips a *known* op suffix from the allowed set (`_gte/_lte/_gt/_lt/_in`) and
  treats the remainder as the code — e.g. `f_ram_gb_gte` → code `ram_gb`, op
  `gte`; no suffix → eq. The code is then validated against the metadata
  whitelist.
- Supported ops: eq (default), `gte`/`lte`/`gt`/`lt` (number/date), `in` (text).
- **`price` is special-cased** (relational, not EAV): `price_lt/lte/gt/gte`
  filter `products.price`, and `sort=price` orders by the column directly — no
  join, no attribute-metadata lookup.
- **Guardrails**: an attribute is only usable in a filter if
  `is_filterable = true`, and in `sort` if `is_sortable = true` — enforced from
  metadata, which also prevents SQL injection via attribute codes (codes are
  validated against the whitelist, values go through parameterised queries).
- Response is `{ items, total, page, limit }` so the UI can paginate; `total` is
  a `COUNT(*)` over the same filter (without `LIMIT`).
- Response includes the generated SQL + row count + timing (behind `?explain=1`)
  so the UI/user can *see* the join fan-out grow with each added filter.

### 8.3 Create / update body

```jsonc
// POST /api/products
{
  "sku": "LP-2001", "name": "UltraBook 14", "category": "laptops",
  "price": 1299.00,
  "attributes": { "cpu": "Ryzen 7", "ram_gb": 32, "tdp_w": 28, "touchscreen": true }
}
```

- Server looks up each attribute's `data_type`, routes the value into the right
  `value_*` column, and upserts into `product_attribute_values` in one
  transaction. Unknown codes / type mismatches → `400` with a clear message.
- `PUT` accepts a partial `attributes` object (upsert changed, leave others).

---

## 9. Minimal UI

A single static page (`public/index.html` + `public/app.js`, vanilla JS, no
build step) served by the same Express server at `/`. Talks only to the API.

Three panels:

1. **Filter / sort** — the filter controls are **built dynamically** from
   `GET /api/categories`: pick a category → the panel renders one input per
   `is_filterable` attribute (dropdown for text, min/max for number/date,
   checkbox for bool) plus a `price <` box and a **sort** dropdown listing
   `is_sortable` attributes. Text dropdowns are populated from a
   `GET /api/attributes/:code/values` endpoint (`SELECT DISTINCT value_text …`)
   so options like colors/sizes reflect actual data. Submitting issues the
   `GET /api/products` query and renders results in a table; a toggle shows the
   generated SQL + timing so the EAV joins are visible.
2. **Create / update** — a form that (again) renders its attribute fields from
   the selected category's metadata; submits to `POST` / `PUT`. Clicking a row
   in the results table loads it into the form for editing.
3. **Seed** — a small form (category, count, checkboxes for which attributes to
   include, value ranges) that posts to `POST /api/seed` and reports how many
   were created — the configurable generator of §7 exposed to the browser.

Deliberately framework-free and unstyled-beyond-basic so it stays "minimal" and
diff-reviewable; the interesting logic is metadata-driven form/query building,
which is the whole point of EAV.

---

## 10. Project structure (mirrors siblings, + api/ui)

```
07 entity–attribute–value/
├── plan.md                     ← this file
├── README.md                   ← concept, commands, indexing, "where it breaks", API/UI usage
├── docker-compose.yml          ← postgres:16-alpine, port 5470:5432
├── package.json                ← scripts: setup / demo / seed / api / all
├── .env.example                ← connection + SEED_* + API_PORT knobs
├── .gitignore                  ← data/ .env node_modules/
├── setup-database.js           ← create schema, seed categories/attributes/products
├── seed.js                     ← CLI: configurable batch generation (§7)
├── server.js                   ← Express REST API + serves the UI (§8, §9)
├── demonstrate-queries.js      ← run + time the hard queries, print EXPLAIN
├── utils/
│   ├── config.js               ← env → config (same shape as siblings)
│   ├── sql-runner.js           ← pool + runSQL/query/timedQuery
│   ├── data-generator.js       ← generateProducts(seedConfig) — shared generator
│   └── query-builder.js        ← builds dynamic filter/sort SQL from params + metadata
├── public/
│   ├── index.html              ← minimal UI shell (filter / create / seed panels)
│   └── app.js                  ← vanilla JS: metadata-driven forms + fetch calls
└── scripts/
    ├── setup/
    │   ├── 00_create_schema.sql        ← categories, attributes, category_attributes, products, PAV
    │   ├── 01_seed_categories.sql      ← 3 categories + attribute metadata
    │   └── 02_create_indexes.sql       ← the §5 indexing strategy
    └── queries/
        ├── 10_filter_multi_attr.sql    ← red AND size M AND price<100 (+EXISTS/pivot)
        ├── 11_sort_typed.sql           ← laptops by ram_gb desc
        ├── 12_pivot_wide.sql           ← reconstruct wide row via jsonb_object_agg
        └── 13_breakdown_demo.sql       ← many-join fan-out + bad estimates
```

Port **5470** for Postgres; API/UI on `API_PORT` (default **3070**). Siblings
use DB ports 5432–5460, so these avoid collisions.

Language: **plain Node.js** (CommonJS + `pg` + `dotenv` + `express`) to match
every sibling project — no build step, `npm run all` just works.

---

## 11. Commands (package.json scripts)

| Command         | Description                                                       |
|-----------------|-------------------------------------------------------------------|
| `npm install`   | install `pg`, `dotenv`, `express`                                |
| `docker-compose up -d` | start PostgreSQL on 5470                                   |
| `npm run setup` | create schema, seed categories/attributes, generate products     |
| `npm run demo`  | run the hard queries with timings + `EXPLAIN ANALYZE`           |
| `npm run seed`  | CLI batch generation, configurable count + attributes (§7)       |
| `npm run api`   | start the REST API + serve the UI at `http://localhost:3070`     |
| `npm run all`   | `setup` then `demo`                                              |

---

## 12. Deliverables checklist (maps to the requirements)

- [x] Schema: `products`, `attributes` metadata, typed `product_attribute_values`
- [x] 3 categories with different attribute sets (books / t-shirts / laptops)
- [x] Multi-attribute filter query (join + EXISTS + pivot variants)
- [x] Sort on a typed attribute (numeric, correct ordering)
- [x] Indexing strategy for the value table (per-type partial indexes)
- [x] Notes on where EAV performance breaks down + alternatives
- [x] **REST API**: create/update product + dynamic AND-filter + typed sort (§8)
- [x] **Minimal UI**: metadata-driven create/update + filter/sort + seed (§9)
- [x] **Configurable seeding**: count + per-attribute inclusion/values (§7)
- [x] PostgreSQL + Node.js, same layout/tooling as sibling projects
