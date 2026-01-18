# PostgreSQL Logical Replication with Node.js

A complete example demonstrating PostgreSQL Logical Replication with a Node.js subscriber process that processes database changes and uses replication slot feedback for acknowledgment.

## Overview

This example shows how to:
- Replicate an entire PostgreSQL database to another system
- Perform initial table copy of all existing data
- Capture and apply changes that occur during the copy process
- Subscribe to database changes using Node.js logical replication
- Process INSERT, UPDATE, and DELETE events in real-time
- Detect when databases are in sync and notify
- Implement checkpoint mechanism for resumable processing
- Use replication slot feedback to prevent WAL accumulation
- Handle failed events with automatic retry on restart

## Prerequisites

- Docker and Docker Compose installed
- Node.js 16+ installed
- Basic understanding of PostgreSQL and replication concepts

## Architecture

### Logical Replication Flow

```
PostgreSQL Database
  ↓ (WAL changes)
Publication (users, orders, products)
  ↓ (pgoutput format)
Replication Slot (my_slot)
  ↓ (binary stream)
Node.js Subscriber
  ↓ (pg-logical-replication decoder)
Event Processor (INSERT/UPDATE/DELETE)
  ↓ (on success)
Checkpoint Manager (saves LSN)
  ↓ (feedback)
PostgreSQL (confirms processed position)
```

### Components

1. **Publication**: Defines which tables to replicate (`users`, `orders`, `products`)
2. **Replication Slot**: Retains WAL data until confirmed as processed
3. **Subscriber**: Node.js process that receives and processes changes
4. **Checkpoint Manager**: Tracks last processed LSN (Log Sequence Number)
5. **Event Processor**: Handles INSERT, UPDATE, DELETE operations
6. **Feedback Mechanism**: Confirms processed positions to PostgreSQL

## Setup

### Quick Start

Follow these steps in order:

```bash
# 1. Start PostgreSQL
docker-compose up -d

# 2. Install Node.js dependencies
npm install

# 3. Configure environment (optional, defaults work with docker-compose)
cp .env.example .env

# 4. Create tables and sample data
node setup-data.js

# 5. Configure replication (first run)
node start-copy.js

# 6. Restart PostgreSQL to apply WAL settings
docker-compose restart

# 7. Start replication subscriber (second run)
node start-copy.js

# 8. (Optional) In another terminal, simulate database activity
node simulate-activity.js 1000 60
```

The subscriber will perform an initial copy of all existing data, then continuously replicate changes. When you run the activity simulator, you'll see all operations being replicated in real-time!

### Detailed Setup Steps

#### 1. Start PostgreSQL

```bash
docker-compose up -d
```

This starts PostgreSQL 16 with:
- Default configuration (no custom WAL settings yet)
- Data persisted in `./data` folder
- Available at `localhost:5432`

#### 2. Install Dependencies

```bash
npm install
```

Installs required packages:
- `pg` - PostgreSQL client
- `pg-logical-replication` - Logical replication decoder
- `dotenv` - Environment configuration

#### 3. Configure Environment

```bash
cp .env.example .env
```

Default values work with docker-compose. Edit `.env` if needed:
- Database connection settings
- Replication slot name
- Publication name
- Checkpoint interval

#### 4. Initialize Database

```bash
node setup-data.js
```

**Executes:** `scripts/01_setup_tables.sql`

**Creates:**
- `users` table with 10 sample users
- `products` table with 8 sample products
- `orders` table with 20 sample orders

**SQL Operations:**
```sql
CREATE TABLE users (id SERIAL PRIMARY KEY, username VARCHAR(50), email VARCHAR(100), ...);
CREATE TABLE products (id SERIAL PRIMARY KEY, name VARCHAR(100), price DECIMAL(10,2), ...);
CREATE TABLE orders (id SERIAL PRIMARY KEY, user_id INTEGER, product_id INTEGER, ...);
INSERT INTO users VALUES (...);
-- ... sample data inserts
```

#### 5. Configure Replication (First Run)

```bash
node start-copy.js
```

**What happens on first run:**

1. **Checks `wal_level`** - Detects it's not set to `logical`
2. **Executes:** `scripts/02_configure_wal.sql` (ALTER SYSTEM commands only)
   ```sql
   ALTER SYSTEM SET wal_level = 'logical';
   ALTER SYSTEM SET max_replication_slots = 4;
   ALTER SYSTEM SET max_wal_senders = 4;
   ```
3. **Executes:** `scripts/00_create_checkpoint.sql`
   ```sql
   CREATE TABLE IF NOT EXISTS replication_checkpoints (
       slot_name VARCHAR(64) PRIMARY KEY,
       last_lsn PG_LSN NOT NULL,
       last_processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       status VARCHAR(20) DEFAULT 'active'
   );
   INSERT INTO replication_checkpoints (slot_name, last_lsn, status)
   VALUES ('my_slot', '0/0', 'initialized')
   ON CONFLICT (slot_name) DO NOTHING;
   ```
4. **Exits with message:** PostgreSQL restart required

**Note:** Checkpoint table is created now because it doesn't require `wal_level=logical`.

#### 6. Restart PostgreSQL

```bash
docker-compose restart
```

This applies the WAL configuration changes. Verify with:
```bash
docker-compose logs -f postgres
# Wait until you see "database system is ready to accept connections"
```

Or check the setting:
```bash
docker exec -it replica-stream-db psql -U postgres -d testdb -c "SHOW wal_level;"
```

Should output: `logical`

#### 7. Start Replication (Second Run)

```bash
node start-copy.js
```

**What happens on second run:**

1. **Checks `wal_level`** - Confirms it's `logical`
2. **Creates publication** (separate transaction):
   ```sql
   CREATE PUBLICATION my_pub FOR TABLE users, orders, products;
   ```
3. **Creates replication slot** (separate transaction):
   ```sql
   SELECT pg_create_logical_replication_slot('my_slot', 'test_decoding');
   ```

4. **Phase 1: Initial Table Copy**
   - Performs full table copy of existing data from source database
   - Copies all rows from `users`, `products`, and `orders` tables
   - Displays progress for each table
   - Any changes during this copy are captured by the replication slot

5. **Phase 2: Continuous Replication**
   - Connects to replication stream
   - Subscribes to slot `my_slot` starting from creation time
   - Processes changes that occurred during the initial copy
   - Continues processing ongoing changes in real-time

6. **Sync Notification**
   - Monitors replication lag
   - When lag reaches 0 bytes, displays "DATABASES ARE IN SYNC!" message
   - Continues monitoring for new changes

**Why separate transactions?** PostgreSQL doesn't allow creating a replication slot in a transaction that has performed writes. Each `client.query()` executes in its own transaction.

## Usage

### Monitor Replication

In the terminal running `start-copy.js`, you'll see:
- Transaction BEGIN/COMMIT messages
- INSERT/UPDATE/DELETE events with data
- Checkpoint saves (LSN positions)
- Processing statistics

### Simulate Database Activity

To test replication with realistic database activity, use the activity simulator script:

```bash
# Run with default settings (2 second interval, indefinite)
node simulate-activity.js

# Run with 1 second interval, indefinite
node simulate-activity.js 1000

# Run with 1 second interval for 60 seconds
node simulate-activity.js 1000 60

# Run with 0.5 second interval for 30 seconds
node simulate-activity.js 500 30
```

**What it does:**
- Randomly performs INSERT, UPDATE, and DELETE operations
- 25% inserts (users, products, orders)
- 45% updates (users, products, orders)
- 30% deletes (orders only)
- Displays statistics on shutdown

**Usage:**
```bash
node simulate-activity.js [interval_ms] [duration_seconds]

# Press Ctrl+C to stop and see statistics
```

You'll see all changes immediately processed in the replication subscriber terminal.

### Make Manual Changes

You can also make manual changes via SQL:

```bash
# Connect to PostgreSQL
docker exec -it replica-stream-db psql -U postgres -d testdb

# Insert a new user
INSERT INTO users (username, email) VALUES ('newuser', 'newuser@example.com');

# Update an existing user
UPDATE users SET email = 'newemail@example.com' WHERE username = 'alice';

# Delete a user
DELETE FROM users WHERE username = 'bob';

# Insert an order
INSERT INTO orders (user_id, product_id, quantity, total_price, status)
VALUES (1, 1, 1, 999.99, 'pending');
```

### Stop Replication

Press `Ctrl+C` in the subscriber terminal. The process will:
1. Save the current checkpoint
2. Close replication connection
3. Exit gracefully

When you restart with `node start-copy.js`, it will resume from the last checkpoint.

## Checkpoint & Retry Mechanism

### How Checkpoints Work

1. Events are batched by transaction (BEGIN...COMMIT)
2. All events in a transaction are processed
3. If **all events succeed**:
   - Checkpoint is saved with current LSN
   - Feedback is sent to PostgreSQL
   - Transaction is confirmed
4. If **any event fails**:
   - Checkpoint is NOT saved
   - Feedback is NOT sent
   - On restart, transaction will be reprocessed

### LSN (Log Sequence Number)

- Format: `segment/offset` (e.g., `0/16B5690`)
- Tracks position in PostgreSQL WAL (Write-Ahead Log)
- Stored in `replication_checkpoints` table
- Used to resume replication after restart

### At-Least-Once Delivery

This example implements **at-least-once** delivery:
- Events may be reprocessed if processing fails
- Idempotent processing is recommended
- Use transaction boundaries for consistency

## Troubleshooting

### "wal_level is not logical"

**Problem**: PostgreSQL is not configured for logical replication

**Solution**:
```bash
# Restart PostgreSQL
docker-compose restart

# Verify configuration
docker exec -it replica-stream-db psql -U postgres -d testdb -c "SHOW wal_level;"
```

### "replication slot does not exist"

**Problem**: Replication slot was not created or was dropped

**Solution**:
```sql
-- Recreate the slot
SELECT pg_create_logical_replication_slot('my_slot', 'pgoutput');
```

### Replication Lag

**Check slot status**:
```sql
-- View replication slot lag
SELECT
  slot_name,
  active,
  pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn) AS lag_bytes
FROM pg_replication_slots
WHERE slot_name = 'my_slot';
```

### Reset Replication

If you need to start fresh:

```sql
-- Drop and recreate the slot
SELECT pg_drop_replication_slot('my_slot');
SELECT pg_create_logical_replication_slot('my_slot', 'pgoutput');

-- Reset checkpoint
UPDATE replication_checkpoints SET last_lsn = '0/0' WHERE slot_name = 'my_slot';
```

### Database Cleanup

```bash
# Stop and remove containers (keeps data)
docker-compose down

# Remove containers and data
docker-compose down
rm -rf data/
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_HOST` | localhost | PostgreSQL host |
| `POSTGRES_PORT` | 5432 | PostgreSQL port |
| `POSTGRES_DB` | testdb | Database name |
| `POSTGRES_USER` | postgres | Database user |
| `POSTGRES_PASSWORD` | postgres | Database password |
| `REPLICATION_SLOT` | my_slot | Replication slot name |
| `PUBLICATION_NAME` | my_pub | Publication name |
| `CHECKPOINT_INTERVAL_MS` | 5000 | Checkpoint save interval |

### PostgreSQL Settings

Configured automatically by `02_configure_wal.sql`:
- `wal_level = logical`
- `max_replication_slots = 4`
- `max_wal_senders = 4`

## File Structure

```
replica-stream/
├── package.json                    # Dependencies and scripts
├── .env.example                    # Configuration template
├── docker-compose.yml              # PostgreSQL setup
├── .gitignore                      # Git ignore rules
├── setup-data.js                   # Data seeding script
├── start-copy.js                   # Replication starter and orchestrator
├── simulate-activity.js            # Database activity simulator
├── scripts/
│   ├── 00_create_checkpoint.sql   # Create checkpoint tracking table
│   ├── 01_setup_tables.sql        # Create tables and sample data
│   └── 02_configure_wal.sql       # Configure WAL settings (requires restart)
├── utils/
│   ├── config.js                  # Configuration loader
│   ├── subscriber.js              # Replication subscriber
│   ├── processor.js               # Event processor
│   ├── checkpoint.js              # LSN tracking and feedback
│   └── table-copier.js            # Initial table copy utility
└── README.md                       # This file
```

### Execution Order

**Script execution flow:**

1. **setup-data.js** → executes `01_setup_tables.sql`
2. **start-copy.js (first run)** → executes `02_configure_wal.sql` + `00_create_checkpoint.sql`
3. **Restart PostgreSQL** (manual step)
4. **start-copy.js (second run)** → creates publication + slot (in JavaScript, not SQL files)
5. **start-copy.js continues** → starts replication subscriber

**Why some SQL is in JavaScript:**
- Publication and replication slot creation must execute in **separate transactions**
- PostgreSQL restriction: can't create replication slot in a transaction that has performed writes
- Solution: Execute each as separate `client.query()` calls in [start-copy.js](start-copy.js:106-130)

## Advanced Topics

### Custom Event Processing

Modify [utils/processor.js](utils/processor.js) to implement custom business logic:

```javascript
async processInsert(table, newData) {
  if (table === 'orders') {
    // Custom order processing
    await sendOrderNotification(newData);
  }
  // ...
}
```

### Error Handling

The processor returns a result object:
```javascript
{
  success: true|false,
  operation: 'INSERT'|'UPDATE'|'DELETE',
  table: 'table_name'
}
```

Failed events prevent checkpoint advancement, ensuring retry on restart.

### Monitoring

Add monitoring by tracking:
- `EventProcessor.getStats()` - Event counts
- `CheckpointManager.getCheckpointStatus()` - Last processed LSN
- Replication slot lag (SQL query above)

## Resources

- [PostgreSQL Logical Replication](https://www.postgresql.org/docs/current/logical-replication.html)
- [pg-logical-replication](https://github.com/kibae/pg-logical-replication)
- [node-postgres](https://node-postgres.com/)

## License

MIT