# PostgreSQL Replica Migration Testing Environment

A comprehensive testing environment for PostgreSQL migration to a bigger instance via replica synchronization. This project simulates a realistic database migration scenario with automated monitoring and cutover capabilities.

## Overview

This environment allows you to:
- Set up PostgreSQL streaming replication using Docker
- Seed a database with realistic test data
- Simulate high write load with mixed operations (INSERT/UPDATE/DELETE)
- Monitor replication lag and WAL synchronization in real-time
- Perform automated cutover when synchronization criteria are met

## Architecture

```
┌─────────────────┐          Streaming           ┌─────────────────┐
│   Primary DB    │ ────────Replication───────▶  │   Replica DB    │
│  (Port 5432)    │      WAL Streaming           │  (Port 5433)    │
└─────────────────┘                               └─────────────────┘
        │                                                  │
        │                                                  │
        ▼                                                  ▼
 ┌──────────────┐                                 ┌──────────────┐
 │ Write Load   │                                 │  Monitoring  │
 │  Simulator   │                                 │   Scripts    │
 └──────────────┘                                 └──────────────┘
```

### Components

1. **Primary Database** - PostgreSQL 16 on port 5432
2. **Replica Database** - PostgreSQL 16 on port 5433 (streaming from primary)
3. **Seeding Script** - Creates schema and populates with test data
4. **Write Load Simulator** - Generates continuous write traffic
5. **Replication Monitor** - Tracks WAL position and lag metrics
6. **Cutover Orchestrator** - Automates migration process

## Prerequisites

- Docker and Docker Compose
- Python 3.8 or higher
- 2GB free disk space (for database volumes)

## Quick Start

### 1. Setup Environment

```bash
cd replica-migration

# Copy environment template
cp .env.example .env

# (Optional) Edit .env to customize settings
# nano .env
```

### 2. Start Docker Services

```bash
# Start PostgreSQL primary and replica
docker-compose up -d

# Verify services are running
docker-compose ps

# Check logs
docker-compose logs -f postgres-primary
docker-compose logs -f postgres-replica
```

### 3. Install Python Dependencies

```bash
# Create virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r scripts/requirements.txt
```

### 4. Seed the Database

```bash
# Populate primary database with test data
cd scripts
python 01_seed_database.py
```

Expected output:
- 1,000 users
- 500 products
- 2,000 orders with items

### 5. Monitor Replication

Open a terminal and start the replication monitor:

```bash
cd scripts
python 03_monitor_replication.py
```

You should see output showing:
- ✓ Status: HEALTHY
- ✓ In Sync: YES
- Replication state: streaming
- Byte lag: < 1KB
- Time lag: < 1s

### 6. Simulate Write Load (Optional)

Open another terminal to generate write traffic:

```bash
cd scripts
python 02_write_load.py --ops-per-second 100
```

This will generate:
- 50% INSERT operations
- 40% UPDATE operations
- 10% DELETE operations

### 7. Perform Cutover

When ready to test the migration:

```bash
cd scripts

# Test with dry-run first
python 04_cutover.py --dry-run

# Perform actual cutover
python 04_cutover.py
```

## Detailed Usage

### Database Seeding

```bash
python scripts/01_seed_database.py
```

Creates tables:
- `users` - User accounts with JSONB metadata
- `products` - Product catalog
- `orders` - Customer orders
- `order_items` - Order line items
- `audit_log` - Change tracking

### Write Load Simulation

```bash
# Default: 100 operations per second
python scripts/02_write_load.py

# Custom rate
python scripts/02_write_load.py --ops-per-second 200

# Stop with Ctrl+C
```

Statistics are printed every 10 seconds showing operation counts.

### Replication Monitoring

```bash
# Continuous monitoring
python scripts/03_monitor_replication.py

# Monitor for specific duration
python scripts/03_monitor_replication.py --duration 60

# Monitor without saving to file
python scripts/03_monitor_replication.py --no-save
```

Metrics displayed:
- **WAL Positions**: Current LSN on primary and replica
- **Byte Lag**: Data volume difference (target: < 1KB)
- **Time Lag**: Write/Flush/Replay delays (target: < 1s)
- **Health Status**: Overall replication health
- **Sync Status**: Whether in sync with thresholds

Metrics are saved to `logs/monitoring/metrics.jsonl` for analysis.

### Automated Cutover

```bash
# Dry run (no changes made)
python scripts/04_cutover.py --dry-run

# Real cutover with defaults
python scripts/04_cutover.py

# Custom wait time
python scripts/04_cutover.py --max-wait-time 600

# Custom sync check interval
python scripts/04_cutover.py --sync-check-interval 10
```

Cutover process:
1. ✓ Prerequisites check
2. ✓ Wait for sync (byte lag < 1KB, time lag < 1s)
3. ✓ Stop write traffic (coordination point)
4. ✓ Final sync verification
5. ✓ Promote replica to primary
6. ✓ Validate new primary
7. ✓ Demote old primary to read-only

Report saved to `logs/monitoring/cutover_report_*.txt`

## Environment Variables

Edit `.env` to customize:

```bash
# PostgreSQL credentials
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=testdb

# Replication user
REPLICATION_USER=replicator
REPLICATION_PASSWORD=replicator_pass

# Connection settings
PRIMARY_HOST=localhost
PRIMARY_PORT=5432
REPLICA_HOST=localhost
REPLICA_PORT=5433

# Monitoring thresholds
MONITORING_INTERVAL=5          # Seconds between checks
LAG_THRESHOLD_BYTES=1024       # 1KB byte lag threshold
LAG_THRESHOLD_SECONDS=1.0      # 1 second time lag threshold

# Write load
WRITE_OPERATIONS_PER_SECOND=100
```

## Docker Management

```bash
# Start services
docker-compose up -d

# Stop services
docker-compose down

# Stop and remove volumes (clean slate)
docker-compose down -v

# View logs
docker-compose logs -f postgres-primary
docker-compose logs -f postgres-replica

# Access primary database
docker exec -it pg-primary psql -U postgres -d testdb

# Access replica database
docker exec -it pg-replica psql -U postgres -d testdb

# Check replication status on primary
docker exec -it pg-primary psql -U postgres -c "SELECT * FROM pg_stat_replication;"

# Check if replica is in recovery
docker exec -it pg-replica psql -U postgres -c "SELECT pg_is_in_recovery();"
```

## PostgreSQL Replication Concepts

### Streaming Replication
- **Physical replication**: Byte-level WAL streaming
- **Asynchronous**: Primary doesn't wait for replica confirmation
- **Hot standby**: Replica available for read queries

### WAL (Write-Ahead Log)
- Transaction log used for crash recovery and replication
- LSN (Log Sequence Number): Position in WAL stream
- Primary generates WAL, replica replays it

### Replication Slot
- Named connection that prevents WAL deletion
- Guarantees replica can catch up even after downtime
- Slot: `replica_slot` in this environment

### Lag Metrics
- **Byte Lag**: `sent_lsn - replay_lsn` (data volume behind)
- **Write Lag**: Time until written to replica OS
- **Flush Lag**: Time until flushed to replica disk
- **Replay Lag**: Time until applied to replica database

## Monitoring Metrics Explained

### Primary WAL Position
Current write position on primary database.

### Replica Receive/Replay LSN
- **Receive**: WAL received by replica
- **Replay**: WAL applied to replica database

### Replication State
- `startup`: Replica initializing
- `catchup`: Replica catching up to primary
- `streaming`: Normal replication state ✓

### Sync State
- `async`: Asynchronous replication (default)
- `sync`: Synchronous replication
- `potential`: Potential synchronous replica

### Healthy Status
All conditions met:
- ✓ Replica in recovery mode
- ✓ Replication state: streaming
- ✓ Replication slot active
- ✓ No warnings

### In Sync Status
Meets cutover criteria:
- ✓ Byte lag < 1KB
- ✓ Replay lag < 1s
- ✓ Healthy status

## Troubleshooting

### Replication not starting

```bash
# Check primary logs
docker-compose logs postgres-primary

# Check replica logs
docker-compose logs postgres-replica

# Verify replication user exists
docker exec -it pg-primary psql -U postgres -c "\du replicator"

# Check replication slot
docker exec -it pg-primary psql -U postgres -c "SELECT * FROM pg_replication_slots;"
```

### High lag

Common causes:
- Write load too high for network/disk
- Replica hardware slower than primary
- Network latency

Solutions:
- Reduce write load
- Increase `wal_keep_size`
- Check network connectivity

### Connection errors

```bash
# Verify containers are running
docker-compose ps

# Check PostgreSQL is listening
docker exec -it pg-primary netstat -tlnp | grep 5432

# Test connectivity from host
psql -h localhost -p 5432 -U postgres -d testdb
psql -h localhost -p 5433 -U postgres -d testdb
```

### Reset everything

```bash
# Stop containers and remove volumes
docker-compose down -v

# Remove data directories
rm -rf data/ logs/

# Recreate directories
mkdir -p data/primary data/replica logs/primary logs/replica logs/monitoring

# Start fresh
docker-compose up -d
```

## Project Structure

```
replica-migration/
├── docker-compose.yml           # Docker orchestration
├── .env.example                 # Environment template
├── .env                        # Local config (gitignored)
├── README.md                   # This file
├── spec.md                     # Project specification
├── todos.md                    # Implementation tasks
│
├── postgresql/
│   ├── primary/
│   │   ├── postgresql.conf     # Primary configuration
│   │   ├── pg_hba.conf        # Primary auth rules
│   │   └── init-primary.sh    # Primary initialization
│   └── replica/
│       ├── postgresql.conf     # Replica configuration
│       ├── pg_hba.conf        # Replica auth rules
│       └── init-replica.sh    # Replica initialization
│
├── scripts/
│   ├── requirements.txt        # Python dependencies
│   ├── db_config.py           # Database configuration
│   ├── db_connection.py       # Connection utilities
│   ├── 01_seed_database.py    # Data seeding
│   ├── 02_write_load.py       # Load simulation
│   ├── 03_monitor_replication.py  # Monitoring
│   └── 04_cutover.py          # Cutover automation
│
├── data/                       # PostgreSQL data (gitignored)
├── logs/                       # Log files (gitignored)
└── tests/                      # Test scripts
```

## Learning Resources

### PostgreSQL Replication
- [PostgreSQL Replication Documentation](https://www.postgresql.org/docs/current/warm-standby.html)
- [Streaming Replication Setup](https://www.postgresql.org/docs/current/warm-standby.html#STREAMING-REPLICATION)
- [Replication Slots](https://www.postgresql.org/docs/current/warm-standby.html#STREAMING-REPLICATION-SLOTS)

### Monitoring
- [pg_stat_replication](https://www.postgresql.org/docs/current/monitoring-stats.html#MONITORING-PG-STAT-REPLICATION-VIEW)
- [WAL Functions](https://www.postgresql.org/docs/current/functions-admin.html#FUNCTIONS-ADMIN-BACKUP)

### Best Practices
- [High Availability with PostgreSQL](https://www.postgresql.org/docs/current/high-availability.html)
- [Replication Lag Reduction](https://www.postgresql.org/docs/current/warm-standby.html#STREAMING-REPLICATION-ASYNC)

## Contributing

This is a learning and testing environment. Feel free to:
- Experiment with different configurations
- Add monitoring metrics
- Implement different cutover strategies
- Create automated tests

## License

This project is for educational and testing purposes.

## Support

For issues or questions:
- Check logs in `logs/` directory
- Review PostgreSQL documentation
- Examine `spec.md` for design details
- Check `todos.md` for implementation status
