# Plan — Hybrid EAV + Search Engine (OpenSearch) for a Web-Store Product Catalog

## Goal

Demonstrate the **production answer** to the heterogeneous-catalog problem: keep
**PostgreSQL as the source of truth / write model** (core columns relational, the
variable tail in typed EAV — exactly as in sibling `07`), and push a
**denormalized document per product into OpenSearch**, which becomes the **read
model** for browse-and-filter.

A faceted search engine is purpose-built for this: **facets/aggregations** for the
filter sidebar, **arbitrary typed sorting**, and **full-text**, all without the
self-join fan-out that makes EAV hurt (`07`, §6). SQL stays authoritative for
writes and consistency; the index answers every list/filter/sort/search query.

The project follows the same structure as the siblings (`05`–`07`): PostgreSQL in
Docker + **plain Node.js** (CommonJS) with `pg`, SQL files under `scripts/`, a
`demonstrate-queries.js` benchmark runner, plus an Express API + minimal UI —
**now with OpenSearch added to Docker and a PG→OpenSearch sync mechanism.**

> **What changes vs `07`:** the schema, EAV write path, seeding, create/update and
> the transactional core are **unchanged**. New parts: OpenSearch in
> `docker-compose`, a document mapping generated from attribute metadata, a
> **transactional-outbox + indexer** sync worker, a **reindex/backfill** command,
> and the read/query paths (`GET /api/products`, the demo queries, the UI filter
> panel) rebuilt on **OpenSearch instead of SQL self-joins**.

---

## 1. Concept — write model vs read model

Same catalog as `07`: three categories, each with its own attribute set.

| Category   | Attributes (code : type)                                            |
|------------|--------------------------------------------------------------------|
| Books      | `author` (text), `pages` (number), `isbn` (text), `published` (date) |
| T-shirts   | `size` (text), `color` (text), `material` (text), `organic` (bool)  |
| Laptops    | `cpu` (text), `ram_gb` (number), `tdp_w` (number), `touchscreen` (bool) |

**CQRS-style split** (echoes `05`/`06`, but the read store is a search engine):

- **Write model — PostgreSQL (source of truth).** `products` + typed
  `product_attribute_values` EAV, identical to `07`. All writes
  (`POST`/`PUT`/seed) go here in a transaction; PG enforces uniqueness, FKs, the
  `num_nonnulls(...) = 1` type check, etc.
- **Read model — OpenSearch (derived).** One flat, denormalized document per
  product. Every browse/filter/sort/search query hits the index, never the EAV
  joins. The index is disposable: it can always be rebuilt from PG (`reindex`).

The point of the demo is the contrast with `07`: the query that needed **N
self-joins + bad cardinality estimates** in EAV becomes a **single bool query with
aggregations** in OpenSearch — and gains facets and full-text for free.

---

## 2. Schema (PostgreSQL — the write model, unchanged from `07`)

Identical to `07` §2, so the two projects are diff-comparable. Summary:

- `categories (id, code, label)` — lookup.
- `products (id, sku, name, category_id, price, created_at)` — core/hot columns
  stay relational.
- `attributes (id, code, label, data_type, unit, is_filterable, is_sortable)` —
  attribute **metadata**; also **drives the OpenSearch mapping** (§4) and the UI.
- `category_attributes (category_id, attribute_id, is_required)` — which
  attributes belong to which category.
- `product_attribute_values (product_id, attribute_id, value_text, value_number,
  value_bool, value_date, PK(product_id, attribute_id), CHECK num_nonnulls = 1)`
  — the typed EAV core.

### 2.1 New: the outbox table (sync plumbing)

Added to the write schema to make PG→OpenSearch sync **reliable and
transactional** (§5):

```sql
outbox (
  id          BIGSERIAL PRIMARY KEY,
  product_id  BIGINT NOT NULL,        -- which product changed
  op          TEXT   NOT NULL CHECK (op IN ('upsert','delete')),
  enqueued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ            -- NULL = pending
)
```

Every create/update/delete/seed writes an `outbox` row **in the same transaction**
as the data change. The indexer (§5.2) drains it. Index on `(processed_at)
WHERE processed_at IS NULL` for cheap "next batch" scans.

---

## 3. Seed data

Same generator and defaults as `07` §3 (`utils/data-generator.js`, driven by
`setup-database.js`): 3 categories, ~12 attributes with correct
`data_type`/`unit`/flags, default **~30,000 products** (`SEED_PRODUCTS`) across the
categories (~120K EAV rows), realistic value distributions.

**New step:** after seeding PG, run a **full backfill** (`npm run reindex`) to
build the OpenSearch index from the source of truth (§5.3). `npm run setup` chains
schema → seed → create-index → reindex so a fresh clone is query-ready in one
command.

---

## 4. OpenSearch: index mapping (the read model)

### 4.1 One denormalized document per product

```jsonc
// index: products
{
  "id": 123,
  "sku": "LP-2001",
  "name": "UltraBook 14 Ryzen laptop",
  "category": "laptops",
  "price": 1299.00,
  "created_at": "2026-01-04T10:00:00Z",
  "attr": {                     // the EAV tail, flattened + typed
    "cpu": "Ryzen 7",
    "ram_gb": 32,
    "tdp_w": 28,
    "touchscreen": true
  }
}
```

The EAV rows are **pivoted into `attr.*` at index time** — the reconstruction that
was expensive per-query in `07` (§4.3) is done **once on write**, which is the
whole efficiency argument.

### 4.2 Mapping generated from attribute metadata

The index mapping is **built programmatically from the `attributes` table** so the
search-engine field type matches the EAV `data_type` (the same idea as `07`'s
typed `value_*` columns, expressed in OpenSearch):

| EAV `data_type` | OpenSearch field type              | Enables                         |
|-----------------|------------------------------------|---------------------------------|
| `text`          | `keyword` (+ optional `text` sub)  | exact filter, **term facets**, sort |
| `number`        | `long` / `double`                  | **range filter**, numeric sort, histogram/stats facets |
| `bool`          | `boolean`                          | filter, term facet              |
| `date`          | `date`                             | range filter, date-histogram, sort |

- Core fields: `name` → `text` (full-text) **with** a `name.raw` `keyword`
  sub-field (sort/exact); `sku` → `keyword`; `category` → `keyword`; `price` →
  `scaled_float`/`double`; `created_at` → `date`.
- `attr.*` fields are declared explicitly per attribute (no reliance on dynamic
  mapping, which would guess `"8"` vs `8` wrong). A **dynamic template** keyed on a
  naming suffix is the fallback for on-the-fly attributes, but the demo builds the
  mapping from metadata so types are correct and stable.
- `settings`: 1 shard / 0 replicas (single-node demo), a simple analyzer for
  `name`, and `refresh_interval` tuned during bulk backfill (§5.3).
- `utils/os-mapping.js` turns the `attributes` metadata rows into the full
  `mappings` object; `scripts/os/create-index.js` (or `npm run os:create`) applies
  it. Re-running drops & recreates behind `--force`.

---

## 5. Sync mechanism — PostgreSQL → OpenSearch

The core new piece. **Requirement:** PG is authoritative; OpenSearch is kept
eventually-consistent with it, reliably (no lost updates), and can be rebuilt from
scratch at any time.

Chosen approach: **transactional outbox + polling indexer** — the standard,
CDC-lite production pattern, simple enough to read in a demo and correct under
crashes/retries. (Alternatives discussed in §5.4.)

### 5.1 Enqueue (inside the write transaction)

`utils/repository.js` create/update/delete/seed already run in a transaction
(`07`). We add **one `INSERT INTO outbox (product_id, op)`** to that same
transaction. Because it commits atomically with the data change, an event is never
lost and never references an uncommitted product — the key correctness property.

### 5.2 Indexer worker (`sync.js`, `npm run sync`)

A small loop that turns outbox rows into index operations:

1. `SELECT ... FROM outbox WHERE processed_at IS NULL ORDER BY id LIMIT :batch`
   (optionally `FOR UPDATE SKIP LOCKED` so multiple workers are safe).
2. For each `upsert`: read the **current** product from PG pivoted into the
   document shape (reuse `07`'s `getProduct` jsonb pivot, generalized to many
   ids); for each `delete`: emit a delete op.
3. Ship the batch to OpenSearch via the **`_bulk`** API (index/delete actions).
4. On success, `UPDATE outbox SET processed_at = now()` for those ids.
5. Sleep `SYNC_INTERVAL_MS` and repeat. `--once` drains and exits (used by
   `setup`/tests); default is a long-running daemon.

Properties: **at-least-once** delivery (a crash after bulk but before marking
re-sends → harmless because index ops are idempotent upserts keyed by `id`);
reading *current* state means multiple pending events for one product collapse to
one correct document (no ordering hazard).

### 5.3 Full backfill / rebuild (`reindex.js`, `npm run reindex`)

Rebuilds the whole index from PG — used after initial seed and any time the
mapping changes or the index is wiped:

- Create the index with mapping (§4.2), set `refresh_interval: -1` and
  `number_of_replicas: 0` for fast bulk load.
- Stream all products from PG in id-ordered pages, pivot each page to documents,
  push with `_bulk` (configurable `BULK_SIZE`).
- Restore `refresh_interval`, `_refresh` the index, print doc count + timing.
- Idempotent: safe to re-run; documents are keyed by product `id`.

`setup-database.js` calls this after seeding so `npm run setup` leaves both stores
consistent.

### 5.4 Alternatives (README notes, why we chose the outbox)

- **Synchronous dual-write** (index inline in the API request): lowest latency to
  visibility, but a failed index leaves PG and OS diverged with no retry — needs
  the outbox anyway as a safety net. We keep the API path optionally doing a
  **best-effort inline index** for instant UI feedback, with the outbox as the
  authoritative catch-up.
- **CDC from the WAL** (Debezium / logical replication / `wal2json`): no app
  changes, captures every change including out-of-band SQL, but adds Kafka/Connect
  infrastructure — too heavy for this demo; named as the "next step up".
- **`ZomboDB` / PG→ES extensions**: tight coupling, Postgres-version-sensitive.
- **Periodic full reindex only**: simple but stale between runs and O(catalog)
  every cycle — fine for tiny catalogs, not for 30K+ with live edits.

The README includes a short table: **outbox vs dual-write vs CDC vs full-reindex**
(consistency, latency, ops cost, code complexity).

---

## 6. The queries (the point of the demo) — now on OpenSearch

`demonstrate-queries.js` runs each query against **both** stores and prints
timings side by side, so the win is measured, not asserted: the `07` SQL EAV
version (self-joins) vs the OpenSearch version. Query bodies live in
`scripts/os-queries/*.json` (or built in `utils/os-query-builder.js`).

### 6.1 Multi-attribute filter — "red AND size M AND price < 100" (t-shirts)

`07` needed one self-join per predicate. In OpenSearch it is **one `bool`
query** — `filter` clauses are ANDed, cached, and score-free:

```jsonc
{ "query": { "bool": { "filter": [
  { "term":  { "category": "tshirts" } },
  { "term":  { "attr.color": "red" } },
  { "term":  { "attr.size": "M" } },
  { "range": { "price": { "lt": 100 } } }
] } } }
```

Adding a fourth/fifth predicate adds a clause, **not a join** — the demo shows
latency staying flat where `07`'s plan degraded.

### 6.2 Sort on a typed attribute — laptops by RAM desc

```jsonc
{ "query": { "bool": { "filter": [ { "term": { "category": "laptops" } } ] } },
  "sort":  [ { "attr.ram_gb": "desc" } ], "size": 20 }
```

Correct numeric ordering because `attr.ram_gb` is mapped `long` (§4.2) — the same
"typed, not stringly-typed" point as `07` §4.2, enforced by the mapping instead of
separate `value_*` columns.

### 6.3 Facets / aggregations — the filter sidebar (new capability)

The thing EAV **cannot** do cheaply and a search engine does natively — compute
every facet's counts in one round trip:

```jsonc
{ "size": 0,
  "query": { "bool": { "filter": [ { "term": { "category": "tshirts" } } ] } },
  "aggs": {
    "color":    { "terms": { "field": "attr.color" } },
    "size":     { "terms": { "field": "attr.size" } },
    "material": { "terms": { "field": "attr.material" } },
    "price":    { "stats": { "field": "price" } }
  } }
```

Returns the sidebar counts ("Red (42), Blue (30)…") that would each be a separate
`GROUP BY` self-join in EAV. Demonstrate **post-filter / faceted navigation** so
counts reflect the other active filters correctly.

### 6.4 Full-text search — new capability

`{ "multi_match": { "query": "ryzen ultrabook", "fields": ["name^2", "attr.cpu"] } }`
combined with the same `filter`/`sort`/`aggs` — free-text + faceting in one query,
impossible to do well in SQL EAV.

Each query is timed (and `?explain`/`profile` available) so the fan-out cost of
`07` vs the flat OpenSearch cost is concrete.

---

## 7. Indexing / performance notes

Two layers to discuss in the README:

1. **PostgreSQL (write side):** keeps `07`'s indexes for the *reindex/backfill*
   read path (composite PK for the pivot; `products(category_id)` for paging), plus
   the partial index on `outbox(processed_at) WHERE processed_at IS NULL`. It no
   longer needs the per-type value indexes for *querying* (queries moved to OS) —
   the demo notes this as a benefit: the write model is simpler to index.
2. **OpenSearch (read side):** `keyword`/`long`/`boolean`/`date` mappings are the
   "indexes"; `filter`-context clauses are cached bitsets; aggregations use
   doc-values. Tuning shown: `refresh_interval` during bulk, `eager_global_ordinals`
   for high-cardinality facet fields, shard/replica choice for a single node.

### 7.1 Where this architecture costs you (honest trade-offs)

- **Eventual consistency:** a just-written product may be absent from search for a
  few hundred ms (outbox lag + OS refresh). Demo makes the lag visible and explains
  the best-effort inline index that hides it in the UI.
- **Two stores to run, operate, and keep in sync;** the index can drift and must be
  rebuildable (why `reindex` exists).
- **Write amplification / pipeline:** every write → EAV rows **+** outbox row **+**
  bulk index op.
- **Reindex cost** on mapping changes; no cross-store transactions.
- Compared with `07`: we trade EAV's simple single-store consistency for query
  power and flat read latency — the classic CQRS bargain (ties back to `05`/`06`).

---

## 8. Configurable seeding

Unchanged from `07` §7 — same `generateProducts(seedConfig)` core, same CLI
(`node seed.js --category laptops --count 500 --attrs ...`) and `POST /api/seed`.
The **only** addition: seeding enqueues outbox rows (or the seed path calls the
bulk backfill directly for large batches), so generated products appear in
OpenSearch. The seed panel in the UI works exactly as before, now feeding the
index too.

---

## 9. Minimal REST API

Same **Express** server and endpoints as `07` §8, with the **read paths moved to
OpenSearch** and the write paths unchanged (PG + outbox).

### 9.1 Endpoints

| Method & path            | Backing store | Purpose                                        |
|--------------------------|---------------|------------------------------------------------|
| `GET  /api/categories`   | PG            | categories + attribute metadata (drives UI/mapping) |
| `GET  /api/attributes`   | PG            | full attribute metadata                        |
| `GET  /api/products`     | **OpenSearch**| **dynamic filter + sort + facets + text** (§9.2) |
| `GET  /api/products/:id` | **OpenSearch**| one product document (PG fallback if not yet indexed) |
| `POST /api/products`     | PG (+outbox)  | create product + attribute values              |
| `PUT  /api/products/:id` | PG (+outbox)  | update core fields / attribute values          |
| `POST /api/seed`         | PG (+outbox)  | generate a batch (§8)                          |
| `GET  /api/sync/status`  | PG + OS       | pending outbox count, index doc count, lag (demo insight) |

`GET /api/attributes/:code/values` (dropdowns) is now served by an OpenSearch
**terms aggregation** instead of `SELECT DISTINCT` — one more place the index
replaces an EAV scan.

### 9.2 Dynamic filter + sort + facets query params

`GET /api/products` accepts the same param shape as `07` §8.2 (so the two APIs are
comparable), translated into an OpenSearch body by `utils/os-query-builder.js`:

```
?category=tshirts
&q=cotton                       → full-text multi_match (new)
&price_lt=100                   → range filter on price
&f_color=red                    → term filter on attr.color
&f_size=M                       → term filter on attr.size
&f_ram_gb_gte=16                → range filter on attr.ram_gb
&sort=ram_gb&dir=desc           → sort on typed attr field
&facets=color,size,price        → aggregations for the sidebar (new)
&page=1&limit=20
```

- Same `f_<code>[_op]` key parsing and `_gte/_lte/_gt/_lt/_in`/eq op set as `07`;
  each maps to a `term`/`terms`/`range` **filter clause** instead of a self-join.
- Same **metadata guardrails**: only `is_filterable` attrs are accepted in filters,
  only `is_sortable` in `sort`; codes validated against the whitelist (also
  prevents injecting arbitrary field names into the query body).
- `price` and core fields resolve to top-level document fields; `attr.*` for EAV
  attributes — the builder picks the path from the attribute's `data_type`.
- Response `{ items, total, page, limit, facets, ms }`; `total` comes from the hit
  count (no separate COUNT query). `?explain=1` returns the generated OpenSearch
  body + `profile` so the UI can *show* the single flat query — the visual contrast
  with `07`'s growing join list.

### 9.3 Create / update body

Identical to `07` §8.3 (same JSON, same PG transaction + typed-column routing). The
server additionally writes the outbox row; the response can `?wait=1` to block
until the document is indexed (drains one sync cycle) so tests/UI see it
immediately.

---

## 10. Minimal UI

Same three-panel vanilla-JS page as `07` §9 (`public/index.html` + `app.js`),
metadata-driven, no build step — extended for the search engine:

1. **Filter / sort / search** — built from `GET /api/categories`: one control per
   `is_filterable` attribute, a `price <` box, a **sort** dropdown, **plus** a
   free-text search box and a **facet sidebar** rendered from the `facets` in the
   response (checkbox lists with live counts). A toggle shows the generated
   **OpenSearch query body + timing** next to the equivalent `07` SQL, so the join
   fan-out vs flat-query story is on screen.
2. **Create / update** — unchanged from `07`; on submit shows a small "indexed in
   N ms" badge (from `?wait=1`) so eventual consistency is tangible.
3. **Seed** — unchanged; posts to `POST /api/seed`.
4. **Sync status strip** — tiny readout of `GET /api/sync/status` (pending outbox,
   indexed docs, lag) so the sync mechanism is observable.

---

## 11. Project structure (mirrors `07`, + OpenSearch)

```
08 entity–attribute–value-and-OS/
├── plan.md                     ← this file
├── README.md                   ← concept, CQRS split, sync, OS queries, trade-offs, commands
├── docker-compose.yml          ← postgres:16-alpine (5480) + opensearch (9280) [+ dashboards]
├── package.json                ← scripts: setup / demo / seed / api / sync / reindex / os:create
├── .env.example                ← PG + OPENSEARCH_* + SEED_* + API_PORT + SYNC_* knobs
├── .gitignore                  ← data/ os-data/ .env node_modules/
├── setup-database.js           ← schema + seed + create-index + reindex (one shot)
├── seed.js                     ← CLI configurable batch generation (→ PG + outbox)
├── sync.js                     ← outbox→OpenSearch indexer worker (§5.2)
├── reindex.js                  ← full PG→OpenSearch backfill / rebuild (§5.3)
├── server.js                   ← Express API (reads=OS, writes=PG) + serves UI
├── demonstrate-queries.js      ← run + time queries: SQL-EAV vs OpenSearch, side by side
├── utils/
│   ├── config.js               ← env → config (PG + OpenSearch)
│   ├── sql-runner.js           ← pg pool + runSQL/query/timedQuery
│   ├── os-client.js            ← OpenSearch client wrapper (bulk, search, indices)
│   ├── os-mapping.js           ← attribute metadata → index mapping (§4.2)
│   ├── os-query-builder.js     ← params + metadata → OpenSearch query body (§9.2)
│   ├── data-generator.js       ← generateProducts(seedConfig) — shared, unchanged
│   ├── indexer.js              ← pivot PG rows → documents; bulk upsert/delete (shared by sync/reindex)
│   └── repository.js           ← PG reads/writes + outbox enqueue (from `07` + outbox)
├── public/
│   ├── index.html              ← filter/facets/search + create + seed + sync-status panels
│   └── app.js                  ← vanilla JS: metadata-driven forms + facet sidebar + fetch
└── scripts/
    ├── setup/
    │   ├── 00_create_schema.sql   ← categories, attributes, category_attributes, products, PAV, outbox
    │   └── 01_seed_categories.sql ← 3 categories + attribute metadata
    └── os-queries/
        ├── 10_filter_multi_attr.json  ← red AND size M AND price<100 (bool filter)
        ├── 11_sort_typed.json         ← laptops by ram_gb desc
        ├── 12_facets_sidebar.json     ← terms + stats aggregations
        └── 13_fulltext.json           ← multi_match + filter + aggs
```

Ports (avoid sibling collisions — `07` uses PG **5470**):
- PostgreSQL **5480** → 5432
- OpenSearch **9280** → 9200 (and **9680** → 9600 perf-analyzer)
- OpenSearch Dashboards (optional) **5681** → 5601
- API / UI on `API_PORT` default **3080**

Language: **plain Node.js** (CommonJS) — `pg`, `dotenv`, `express`, and
`@opensearch-project/opensearch`. No build step; `npm run all` just works.

---

## 12. Commands (package.json scripts)

| Command            | Description                                                          |
|--------------------|---------------------------------------------------------------------|
| `npm install`      | install `pg`, `dotenv`, `express`, `@opensearch-project/opensearch` |
| `docker-compose up -d` | start PostgreSQL (5480) + OpenSearch (9280)                     |
| `npm run setup`    | schema + seed PG + create index + full reindex (both stores ready)  |
| `npm run demo`     | run the hard queries, **SQL-EAV vs OpenSearch** timings side by side |
| `npm run sync`     | start the outbox→OpenSearch indexer worker (`--once` to drain+exit)  |
| `npm run reindex`  | rebuild the OpenSearch index from PostgreSQL (backfill)              |
| `npm run os:create`| (re)create the index + mapping from attribute metadata (`--force`)  |
| `npm run seed`     | CLI batch generation → PG + outbox                                  |
| `npm run api`      | start REST API + UI at `http://localhost:3080` (reads OS, writes PG)|
| `npm run all`      | `setup` then `demo`                                                 |

---

## 13. Deliverables checklist (maps to the requirements)

- [x] **Hybrid architecture**: PG (core columns + typed EAV) as source of truth;
      OpenSearch as the read model — same functionality as `07`
- [x] **OpenSearch added to `docker-compose`** (single node + optional Dashboards)
- [x] **Denormalized product document** + mapping generated from attribute metadata
- [x] **Query operations run on OpenSearch**: multi-attr filter, typed sort,
      **facets/aggregations**, **full-text** — no self-join fan-out
- [x] **Sync mechanism PG→OpenSearch**: transactional outbox + polling indexer,
      full backfill/reindex, alternatives compared (dual-write / CDC)
- [x] **REST API**: writes → PG (+outbox), reads → OpenSearch; same param contract
      as `07` for direct comparison
- [x] **Minimal UI**: metadata-driven forms + facet sidebar + full-text + sync
      status
- [x] **Configurable seeding** carried over from `07`, now feeding the index
- [x] **`demonstrate-queries.js`** shows the EAV-vs-search-engine performance
      contrast concretely
- [x] PostgreSQL + Node.js, same layout/tooling as sibling projects
```
