# PostgreSQL Sharding with Citus

Demonstrates horizontal sharding in PostgreSQL using the Citus extension. This project shows the complete journey from a regular PostgreSQL table to a distributed system and back.

## Quick Start

```bash
# 1. Start the cluster
docker-compose up -d --build

# 2. Install dependencies
npm install

# 3. Run all 4 phases automatically
npm run all

# Or run phases individually:
npm run phase1    # Setup regular PostgreSQL tables
npm run phase2    # Enable Citus, distribute tables
npm run phase3    # Add worker, rebalance shards
npm run phase4    # Undistribute back to regular tables
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Docker Network                              │
│                                                                  │
│   ┌──────────────────────┐                                       │
│   │     Coordinator      │  ← Application connects here          │
│   │     (Port 5440)      │  ← Routes queries to workers          │
│   └──────────┬───────────┘                                       │
│              │                                                   │
│        ┌─────┴─────┐                                             │
│        │           │                                             │
│   ┌────▼────┐ ┌────▼────┐ ┌─────────┐                            │
│   │ Worker1 │ │ Worker2 │ │ Worker3 │  ← Added during resharding │
│   │  :5441  │ │  :5442  │ │  :5443  │                            │
│   └─────────┘ └─────────┘ └─────────┘                            │
└─────────────────────────────────────────────────────────────────┘
```

## Phases

### Phase 1: Regular PostgreSQL (Baseline)
- Creates standard tables: `orders`, `users`, `regions`, `order_items`
- Seeds 1,000 users and 10,000 orders
- No Citus enabled yet - regular PostgreSQL behavior

### Phase 2: Distribute Tables
- Enables Citus extension
- Registers worker1 and worker2
- Distributes `orders` and `order_items` by `user_id`
- Makes `regions` a reference table (replicated to all workers)

### Phase 3: Resharding
- Adds worker3 to the cluster
- Rebalances shards across all 3 workers
- Optional: Isolate hot tenant, drain workers

### Phase 4: Undistribute
- Consolidates all data back to coordinator
- Tables become regular PostgreSQL tables again
- Workers can be stopped

## Commands

| Command | Description |
|---------|-------------|
| `npm run setup` | Create tables, seed data |
| `npm run load` | Continuous data generator |
| `npm run demo` | Run demonstration queries |
| `npm run enable-citus` | Enable Citus, distribute tables |
| `npm run add-worker` | Add worker3 to cluster |
| `npm run rebalance` | Redistribute shards evenly |
| `npm run isolate` | Isolate hot tenant |
| `npm run drain` | Drain and remove worker |
| `npm run undistribute` | Back to regular PostgreSQL |

## Key Concepts

### Distribution Column (Shard Key)
The column used to determine which shard stores each row:
```sql
SELECT create_distributed_table('orders', 'user_id');
```

### Reference Tables
Small tables replicated to all workers for efficient joins:
```sql
SELECT create_reference_table('regions');
```

### Colocation
Related tables distributed by the same key have matching shards on the same worker:
```sql
SELECT create_distributed_table('order_items', 'user_id',
    colocate_with => 'orders');
```

## Monitoring

```sql
-- Active workers
SELECT * FROM citus_get_active_worker_nodes();

-- Shard distribution
SELECT nodename, COUNT(*) as shards
FROM citus_shards
GROUP BY nodename;

-- Check distributed tables
SELECT * FROM citus_tables;
```

## Cleanup

```bash
# Stop containers (keeps data)
docker-compose down

# Full reset (removes all data)
docker-compose down -v
```


## Results

### Single DB (5,6 Gb)

Users           1M
Orders          10M
Ordersitems     20M

┌─────────┬────┬─────────────────────────────────────────┬───────────────┐
│ (index) │ #  │ Title                                   │ Duration (ms) │
├─────────┼────┼─────────────────────────────────────────┼───────────────┤
│ 0       │ 1  │ 'Orders for user 42'                    │ '108.00'      │
│ 1       │ 2  │ 'User 42 Statistics'                    │ '16.00'       │
│ 2       │ 3  │ 'Colocated join (orders + order_items)' │ '13.00'       │
│ 3       │ 4  │ 'Total order count'                     │ '1181.00'     │
│ 4       │ 5  │ 'Revenue by Region'                     │ '2117.00'     │
│ 5       │ 6  │ 'Orders by status'                      │ '885.00'      │
│ 6       │ 7  │ 'Reference table join'                  │ '12.00'       │
│ 7       │ 8  │ 'Local table join'                      │ '4.00'        │
│ 8       │ 9  │ 'Multi-table join'                      │ '10.00'       │
│ 9       │ 10 │ 'Overall Statistics'                    │ '25010.00'    │
│ 10      │ 11 │ 'Top 10 Users by Order Count'           │ '8207.00'     │
│ 11      │ 12 │ 'Orders by Date'                        │ '1993.00'     │
└─────────┴────┴─────────────────────────────────────────┴───────────────┘

### 2 Shards Single DB (5,6 Gb + 3.6 Gb + 3.6 Gb)

Users           1M
Orders          10M
Ordersitems     20M

┌─────────┬────┬─────────────────────────────────────────┬───────────────┐
│ (index) │ #  │ Title                                   │ Duration (ms) │
├─────────┼────┼─────────────────────────────────────────┼───────────────┤
│ 0       │ 1  │ 'Orders for user 42'                    │ '15.00'       │
│ 1       │ 2  │ 'User 42 Statistics'                    │ '4.00'        │
│ 2       │ 3  │ 'Colocated join (orders + order_items)' │ '11.00'       │
│ 3       │ 4  │ 'Total order count'                     │ '218.00'      │
│ 4       │ 5  │ 'Revenue by Region'                     │ '1785.00'     │
│ 5       │ 6  │ 'Orders by status'                      │ '339.00'      │
│ 6       │ 7  │ 'Reference table join'                  │ '4.00'        │
│ 7       │ 8  │ 'Local table join'                      │ '6.00'        │
│ 8       │ 9  │ 'Multi-table join'                      │ '19.00'       │
│ 9       │ 10 │ 'Overall Statistics'                    │ '8786.00'     │
│ 10      │ 11 │ 'Top 10 Users by Order Count'           │ '896.00'      │
│ 11      │ 12 │ 'Orders by Date'                        │ '2034.00'     │
└─────────┴────┴─────────────────────────────────────────┴───────────────┘

### 3 Shards Single DB (5,9 Gb + 2.9 Gb + 2.9 Gb + 2.3 Gb)

Users           1M
Orders          10M
Ordersitems     20M

┌─────────┬────┬─────────────────────────────────────────┬───────────────┐
│ (index) │ #  │ Title                                   │ Duration (ms) │
├─────────┼────┼─────────────────────────────────────────┼───────────────┤
│ 0       │ 1  │ 'Orders for user 42'                    │ '7.00'        │
│ 1       │ 2  │ 'User 42 Statistics'                    │ '5.00'        │
│ 2       │ 3  │ 'Colocated join (orders + order_items)' │ '7.00'        │
│ 3       │ 4  │ 'Total order count'                     │ '801.00'      │
│ 4       │ 5  │ 'Revenue by Region'                     │ '2540.00'     │
│ 5       │ 6  │ 'Orders by status'                      │ '409.00'      │
│ 6       │ 7  │ 'Reference table join'                  │ '6.00'        │
│ 7       │ 8  │ 'Local table join'                      │ '6.00'        │
│ 8       │ 9  │ 'Multi-table join'                      │ '21.00'       │
│ 9       │ 10 │ 'Overall Statistics'                    │ '10070.00'    │
│ 10      │ 11 │ 'Top 10 Users by Order Count'           │ '2529.00'     │
│ 11      │ 12 │ 'Orders by Date'                        │ '1694.00'     │
└─────────┴────┴─────────────────────────────────────────┴───────────────┘