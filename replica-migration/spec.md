# PostgreSQL Replica Migration Testing Environment

## Goal
Test PostgreSQL migration to a bigger instance via replica sync with automated monitoring and cutover.

## Architecture

### Components
1. **Primary Database** (PostgreSQL 16) - Source instance on port 5432
2. **Replica Database** (PostgreSQL 16) - Target instance on port 5433
3. **Seeding Script** - Creates initial test data
4. **Write Load Simulator** - Generates high write traffic (INSERT/UPDATE/DELETE)
5. **Replication Monitor** - Tracks WAL position and lag metrics
6. **Cutover Orchestrator** - Automates migration when sync is achieved

### Replication Configuration
- **Method**: Physical streaming replication
- **Replication Slot**: `replica_slot` (prevents WAL deletion)
- **Mode**: Asynchronous streaming with hot standby
- **Initial Sync**: pg_basebackup from primary

## Monitoring Metrics

### Key Metrics
1. **WAL Positions**: LSN tracking (sent, write, flush, replay)
2. **Replication Lag**:
   - Byte lag: < 1KB threshold
   - Time lag: < 1s threshold (write, flush, replay)
3. **Replication State**: streaming, catchup, startup
4. **Health Indicators**: slot active, replica in recovery

## Cutover Process

### Automated Steps
1. **Prerequisites Check** - Verify connectivity and replication state
2. **Wait for Sync** - Monitor until lag < thresholds (3 consecutive checks)
3. **Stop Write Traffic** - Coordinate with application layer
4. **Final Verification** - Confirm zero byte lag
5. **Promote Replica** - Execute `pg_promote()`
6. **Validate New Primary** - Test writes and verify state
7. **Demote Old Primary** - Set to read-only mode

### Safety Features
- Dry-run mode for testing
- Multiple validation checkpoints
- Timeout limits (300s for sync wait, 30s for promotion)
- Comprehensive logging and reporting

## File Structure

```
replica-migration/
├── docker-compose.yml
├── .env.example
├── .env (gitignored)
├── spec.md (this file)
├── todos.md
├── README.md
│
├── postgresql/
│   ├── primary/
│   │   ├── postgresql.conf
│   │   ├── pg_hba.conf
│   │   └── init-primary.sh
│   └── replica/
│       ├── postgresql.conf
│       ├── pg_hba.conf
│       └── init-replica.sh
│
├── scripts/
│   ├── requirements.txt
│   ├── db_config.py
│   ├── db_connection.py
│   ├── 01_seed_database.py
│   ├── 02_write_load.py
│   ├── 03_monitor_replication.py
│   └── 04_cutover.py
│
├── data/ (gitignored)
├── logs/ (gitignored)
└── tests/
```

## Usage Workflow

```bash
# 1. Setup environment
cp .env.example .env
docker-compose up -d

# 2. Install Python dependencies
pip install -r scripts/requirements.txt

# 3. Seed initial data
python scripts/01_seed_database.py

# 4. Start write load (Terminal 1)
python scripts/02_write_load.py --ops-per-second 100

# 5. Monitor replication (Terminal 2)
python scripts/03_monitor_replication.py

# 6. Execute cutover when ready (Terminal 3)
python scripts/04_cutover.py --dry-run  # Test first
python scripts/04_cutover.py            # Real cutover
```

## Database Schema

### Tables
- **users**: id, username, email, full_name, created_at, updated_at, is_active, metadata (JSONB)
- **products**: id, name, description, price, stock_quantity, category, timestamps
- **orders**: id, user_id, order_date, total_amount, status, shipping_address
- **order_items**: id, order_id, product_id, quantity, unit_price, subtotal
- **audit_log**: id, table_name, record_id, action, changed_data (JSONB), changed_at

### Initial Data
- 1,000 users
- 500 products (6 categories)
- 2,000 orders (1-5 items each)

## Write Load Patterns

### Operation Mix
- 50% INSERT (new users, products, orders)
- 40% UPDATE (user info, product stock, order status)
- 10% DELETE (soft-delete users, purge old logs)

### Configuration
- Configurable ops/sec (default: 100)
- Connection pooling (10 connections)
- Statistics reporting every 10s

## Environment Variables

```
# PostgreSQL Configuration
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=testdb

# Replication User
REPLICATION_USER=replicator
REPLICATION_PASSWORD=replicator_pass

# Connection Settings
PRIMARY_HOST=localhost
PRIMARY_PORT=5432
REPLICA_HOST=localhost
REPLICA_PORT=5433

# Monitoring Thresholds
MONITORING_INTERVAL=5
LAG_THRESHOLD_BYTES=1024
LAG_THRESHOLD_SECONDS=1.0
```

## Success Criteria

- ✓ Docker containers start and pass healthchecks
- ✓ Streaming replication establishes automatically
- ✓ Seeding completes successfully with all data
- ✓ Write load sustains target ops/sec
- ✓ Monitoring shows byte lag < 1KB during steady state
- ✓ Dry-run cutover validates all prerequisites
- ✓ Real cutover promotes replica within 30s
- ✓ New primary accepts writes immediately
- ✓ Old primary becomes read-only
