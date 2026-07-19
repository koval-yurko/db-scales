# Hybrid EAV + OpenSearch — Web-Store Product Catalog

The **production answer** to the heterogeneous-catalog problem from project `07`:
keep **PostgreSQL as the source of truth** (core columns relational, the variable
tail in typed EAV), and push a **denormalized document per product into
OpenSearch**, which becomes the **read model** for browse/filter/sort/search.

A faceted search engine is purpose-built for this: the multi-attribute filter that
needed **N SQL self-joins** in `07` is **one `bool` query** here — and you get
**facets/aggregations** for the sidebar and **full-text** for free. SQL stays
authoritative for writes; the index answers every list query. This is what most
large catalogs actually run.

> **Read `07` first.** This project reuses its schema, seeder, and EAV write path
> verbatim, then adds OpenSearch + the sync mechanism. The two are deliberately
> diff-comparable.

## Quick start

```bash
npm install
docker-compose up -d        # PostgreSQL (5480) + OpenSearch (9280)
npm run setup               # PG schema + ~30k products, then build & backfill the index
npm run demo                # SQL-EAV vs OpenSearch timings, side by side
npm run api                 # REST API + UI at http://localhost:3080
# in a second terminal, to keep the index live as you write:
npm run sync                # outbox -> OpenSearch indexer (daemon)
```

Optional: `docker-compose --profile dashboards up -d` starts OpenSearch
Dashboards at http://localhost:5681 to explore the index by hand.

## Architecture — write model vs read model (CQRS)

```
        writes                                    reads
  ┌──────────────────┐   outbox    ┌──────────┐   ┌──────────────┐
  │  PostgreSQL      │──────────▶  │ sync.js  │──▶│  OpenSearch  │◀── GET /api/products
  │  (source of      │  (same tx)  │ indexer  │   │  (read model)│     filter/sort/facets/text
  │   truth: EAV)    │             └──────────┘   └──────────────┘
  └──────────────────┘
     ▲ POST/PUT/DELETE/seed
```

- **Write model — PostgreSQL.** `products` + typed `product_attribute_values`
  (the EAV from `07`) + an `outbox` table. All writes go here in a transaction.
- **Read model — OpenSearch.** One flat document per product; the EAV rows are
  pivoted into a typed `attr` object **at index time**. Disposable — rebuildable
  from PG at any time (`npm run reindex`).

## Commands

| Command | Description |
|---------|-------------|
| `npm run setup` | PG schema + seed 3 categories + ~30k products, create the index, full backfill |
| `npm run demo`  | Run filter/sort/facet/text queries — **SQL EAV vs OpenSearch** timings |
| `npm run sync`  | Outbox → OpenSearch indexer worker (`-- --once` drains and exits) |
| `npm run reindex` | Rebuild the whole index from PostgreSQL (backfill) |
| `npm run os:create` | (Re)create the index + mapping (`-- --force` to drop first) |
| `npm run seed`  | CLI batch generation → PG + outbox (same flags as `07`) |
| `npm run api`   | Express REST API (writes→PG, reads→OS) + UI |

## The read model: index mapping

The index mapping is **generated from the `attributes` metadata** so each field
type matches the EAV `data_type` (the OpenSearch equivalent of `07`'s typed
`value_*` columns) — see `utils/os-mapping.js`:

| EAV `data_type` | OpenSearch field | Enables |
|-----------------|------------------|---------|
| `text`   | `keyword` (+ `.text` analyzed sub-field) | exact filter, **term facets**, sort, full-text |
| `number` | `double` | **range filter**, numeric sort, stats facets |
| `bool`   | `boolean` | filter, term facet |
| `date`   | `date` (`yyyy-MM-dd`) | range filter, sort |

Core fields: `name` (`text` + `name.raw` keyword), `sku`/`category` (keyword),
`price` (`double`), `created_at` (`date`). Attributes live under `attr.<code>`.

## Sync mechanism — PostgreSQL → OpenSearch

**Transactional outbox + polling indexer** — the standard CDC-lite production
pattern:

1. **Enqueue (in the write tx).** `createProduct` / `updateProduct` /
   `deleteProduct` / batch-seed each `INSERT INTO outbox (product_id, op)` in the
   **same transaction** as the data change (`utils/repository.js`). An event is
   therefore never lost and never references an uncommitted product.
2. **Indexer (`sync.js`).** Polls `outbox WHERE processed_at IS NULL`, reads the
   **current** product state (pivoted to a document), ships a `_bulk`
   index/delete, then stamps the rows processed. Multiple queued events for one
   product collapse to one correct document; a crash before the stamp just
   re-sends — harmless because ops are **idempotent upserts keyed by id**
   (at-least-once delivery).
3. **Backfill (`reindex.js`).** Streams all products from PG and bulk-loads the
   index (with `refresh_interval:-1` during load). Used after the initial seed
   and any time the mapping changes.

The API can also `?wait=1` on a write to synchronously flush the outbox, so the UI
sees the change in search immediately (hides eventual-consistency lag).

### Why the outbox (alternatives)

| Approach | Consistency | Latency | Ops cost | Notes |
|----------|-------------|---------|----------|-------|
| **Outbox + indexer** (this repo) | reliable, eventual | low | one worker | replayable, idempotent |
| Synchronous dual-write | can diverge on failure | lowest | none | needs a safety net anyway |
| CDC (Debezium / logical replication) | reliable, eventual | low | Kafka/Connect | captures out-of-band SQL too; heavier |
| Periodic full reindex | stale between runs | high | simple | O(catalog) each cycle |

## The queries (`npm run demo`)

Each runs against **both** stores where applicable and prints timings:

1. **Multi-attribute filter** — `red AND size M AND price < 100`: `07` = N
   self-joins; here = one `bool` filter. Adding a predicate adds a clause, not a
   join.
2. **Typed sort** — laptops by `ram_gb` desc (numeric, because `attr.ram_gb` is a
   numeric field).
3. **Facets** — the whole t-shirt sidebar (color/size/material/price counts) in
   **one** aggregation query. In SQL EAV each facet is a separate `GROUP BY`
   self-join.
4. **Full-text** — `multi_match` over `name` + attribute text, combined with
   filter + sort. Impractical in SQL EAV.

Raw query bodies are in `scripts/os-queries/*.json`.

## REST API

Base URL `http://localhost:3080`. Writes → PostgreSQL (+outbox); reads →
OpenSearch. Same query-param contract as `07` for direct comparison.

| Method & path | Store | Purpose |
|---------------|-------|---------|
| `GET /api/categories` | PG | categories + attribute metadata |
| `GET /api/attributes` | PG | full attribute metadata |
| `GET /api/attributes/:code/values` | OS | distinct values (terms agg) for dropdowns |
| `GET /api/products` | **OS** | dynamic filter + sort + facets + full-text |
| `GET /api/products/:id` | **OS** | one product doc (PG fallback if not yet indexed) |
| `POST /api/products` | PG | create (`?wait=1` to index synchronously) |
| `PUT /api/products/:id` | PG | update |
| `DELETE /api/products/:id` | PG | delete |
| `POST /api/seed` | PG | generate a batch |
| `GET /api/sync/status` | PG+OS | pending outbox count + indexed doc count |

### Dynamic filter + sort + facets

```
GET /api/products?category=tshirts&f_color=red&f_size=M&price_lt=100&sort=price&dir=asc
GET /api/products?category=laptops&q=ryzen&f_ram_gb_gte=16&sort=ram_gb&dir=desc&facets=cpu,ram_gb,price
```

- `f_<code>` = term; `f_<code>_<op>` with `op ∈ {gte,lte,gt,lt,in}` = range/terms.
  Each becomes one `filter` clause (not a join).
- `q=` = full-text `multi_match`; `facets=` = a comma list of attributes to
  aggregate for the sidebar.
- Same guardrails as `07`: only `is_filterable` can be filtered, `is_sortable`
  sorted; codes validated against the metadata whitelist.
- `&explain=1` returns the generated OpenSearch query body.
- Response: `{ items, total, page, limit, filters, facets, ms, took }`.

## Minimal UI

`npm run api`, open `http://localhost:3080`. Metadata-driven, plus a **full-text
box**, a **clickable facet sidebar** (counts from OpenSearch aggregations), and a
**sync-status strip** (indexed docs / pending outbox). Writes use `?wait=1` so
they show up in search right away.

## Configurable seeding

Identical to `07` (`node seed.js --category laptops --count 500 --attrs cpu,ram_gb`,
`--config seed.config.json`, or the UI Seed panel / `POST /api/seed`). Seeded
products enqueue outbox events — run `npm run sync` (or `npm run reindex`) to index
them, or pass `?wait=1` from the API.

## Trade-offs (vs `07`)

- **Eventual consistency** — a just-written product may be absent from search for
  a few hundred ms (outbox lag + OS refresh); `?wait=1` hides it for the UI.
- **Two stores** to run and keep in sync; the index can drift → must be
  rebuildable (why `reindex` exists).
- **Write pipeline** — every write = EAV rows + outbox row + a bulk index op.
- In exchange: **flat read latency** as filters grow, plus facets and full-text
  that EAV-in-SQL can't do cheaply. The classic CQRS bargain.
