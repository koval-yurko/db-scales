# Implementation Plan: PostgreSQL Logical Replication with Node.js Subscriber

## Overview
Create a complete example of PostgreSQL Logical Replication with a Node.js subscriber process in the `replica-stream/` folder. The subscriber will replicate the entire database to another system, including initial data copy and continuous change capture.

## Requirements Summary
- **Replication Type**: Logical Replication (Publication/Subscription)
- **Technology**: Node.js with `pg` (node-postgres) library and `pg-logical-replication` for decoding
- **Acknowledge Mechanism**: Replication slot with feedback to confirm processed LSN positions
- **Scope**: Node.js code with Docker Compose for PostgreSQL
- **Key Features**:
  - Full database replication (initial copy + continuous changes)
  - Initial table copy phase to transfer existing data
  - Capture changes that occur during the copy process
  - Detect when databases are in sync and notify
  - Ability to mark replication as done or retry failed events
- **Data Coverage**: Replicates ALL data including existing rows via initial table copy

## File Structure

```
replica-stream/
├── package.json                    # Node.js dependencies
├── .env.example                    # Environment variables template
├── docker-compose.yml              # PostgreSQL database setup
├── .gitignore                      # Ignore data folder and .env
├── setup-data.js                   # Data seeding script
├── start-copy.js                   # Start replication and monitor status
├── data/                           # PostgreSQL data folder (local, gitignored)
├── scripts/
│   ├── 01_setup_tables.sql        # Create tables and insert sample data
│   └── 02_setup_replication.sql   # Configure replication (publications, slots)
├── utils/
│   ├── config.js                  # Configuration loader
│   ├── subscriber.js              # Main replication subscriber
│   ├── processor.js               # Event processing logic
│   └── checkpoint.js              # LSN tracking and feedback
└── README.md                       # Documentation and usage
```

## Implementation Steps

### 1. Docker Compose Setup
**File**: `replica-stream/docker-compose.yml`

**Purpose**: Single PostgreSQL database (default configuration)

Configuration:
- PostgreSQL 16 (Alpine image for smaller size)
- Port: 5432
- Database: `testdb`
- User/Password: Configurable via environment
- **Data persistence**: Mount local `./data` folder to `/var/lib/postgresql/data`
- **Default PostgreSQL config**: No custom replication settings initially
- Network: Default bridge network for Node.js access

**Note**: Logical replication will be configured later via SQL scripts and PostgreSQL configuration commands

**File**: `replica-stream/.gitignore`

Ignore local data:
```
data/
.env
node_modules/
```

### 2. Database Setup SQL Scripts

#### Part A: Tables and Sample Data
**File**: `replica-stream/scripts/01_setup_tables.sql`

Create tables and populate with sample data:
- Create sample tables: `users`, `orders`, `products`
- Insert sample data for testing (e.g., 10 users, 8 products, 20 orders)
- Create indexes for performance
- **IMPORTANT**: This file contains only table creation and data insertion - no replication setup

#### Part B: WAL Configuration
**File**: `replica-stream/scripts/02_configure_wal.sql`

Configure PostgreSQL WAL for logical replication:
- `ALTER SYSTEM SET wal_level = 'logical';`
- `ALTER SYSTEM SET max_replication_slots = 4;`
- `ALTER SYSTEM SET max_wal_senders = 4;`
- **Note**: Requires PostgreSQL restart to apply

#### Part C: Checkpoint Table
**File**: `replica-stream/scripts/00_create_checkpoint.sql`

Create checkpoint tracking before restart:
- `CREATE TABLE replication_checkpoints (...)`
- Initialize with LSN `0/0`
- **Can be created before restart** (doesn't require `wal_level=logical`)

#### Part D: Replication Setup (Done in JavaScript)
**File**: `start-copy.js` - `createPublicationAndSlot()`

Create publication and slot (after WAL config + restart):
- Create publication: `CREATE PUBLICATION my_pub FOR TABLE users, orders, products;`
- Create replication slot: `SELECT pg_create_logical_replication_slot('my_slot', 'test_decoding');`
- **Must execute in separate transactions** (PostgreSQL restriction)
- Uses `test_decoding` plugin (compatible with `pg-logical-replication` library)

## Critical Replication Flow for Full Database Copy

**To replicate the entire database to another system:**

1. **Configure WAL settings** → `node start-copy.js` (first run)
2. **Restart PostgreSQL** → `docker-compose restart`
3. **Seed source database** → `node setup-data.js`
   - Creates tables and inserts sample data into source database
4. **Start replication** → `node start-copy.js` (second run)
   - **Phase 1: Create Replication Slot**
     - Creates replication slot to capture ongoing changes
   - **Phase 2: Initial Table Copy**
     - Performs full table copy of existing data
     - Copies all rows from source tables to target system
     - Changes during copy are captured by replication slot
   - **Phase 3: Apply Replicated Changes**
     - Processes changes that occurred during the copy
     - Continues processing ongoing changes
   - **Phase 4: Sync Notification**
     - Detects when replication lag reaches zero
     - Notifies that databases are in sync

**Why this approach:**
- **Replication slot created first**: Captures all changes during the initial copy
- **Initial copy**: Transfers existing data efficiently (bulk copy vs individual INSERTs)
- **Continuous replication**: Applies changes that happened during copy and keeps databases in sync
- **Lag detection**: Monitors when target catches up to source

### 3. Node.js Dependencies (package.json)
**File**: `replica-stream/package.json`

Dependencies:
- `pg`: PostgreSQL client for Node.js (includes replication protocol support)
- `dotenv`: Environment variable management
- `pg-logical-replication`: Decodes pgoutput format WAL messages into JavaScript objects

**Why pg-logical-replication?**
- The `pg` package provides low-level replication protocol access
- WAL messages arrive in binary pgoutput format (PostgreSQL's wire protocol)
- `pg-logical-replication` parses these binary messages into readable events (INSERT, UPDATE, DELETE)
- Without it, you'd need to manually decode PostgreSQL's complex binary protocol
- **Verdict**: Required for practical logical replication - significantly simplifies message decoding

**Note**: No `nodemon` - not needed for this example

### 4. Configuration Module
**Files**:
- `replica-stream/utils/config.js`
- `replica-stream/.env.example`

Environment variables:
```
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=testdb
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
REPLICATION_SLOT=my_slot
PUBLICATION_NAME=my_pub
CHECKPOINT_INTERVAL_MS=5000
```

Config module (`utils/config.js`) loads and validates environment variables, exports configuration object.

### 5. Shared Utilities (utils/)

#### 5a. Configuration (utils/config.js)
Loads and validates environment variables, exports configuration object.

#### 5b. LSN Checkpoint Manager (utils/checkpoint.js)
**Purpose**: Manage LSN tracking and replication slot feedback

Functions:
- `loadLastCheckpoint()`: Load last processed LSN from tracking table
- `saveCheckpoint(lsn)`: Store processed LSN with timestamp
- `sendFeedback(lsn)`: Send standby status update to PostgreSQL with confirmed LSN
- `getCheckpointStatus()`: Get current checkpoint information

**Key Logic**:
- Store LSN in checkpoint tracking table
- Send feedback messages to update replication slot position
- Prevent WAL retention by confirming processed positions

#### 5c. Event Processor (utils/processor.js)
**Purpose**: Process decoded replication events

Event handler functions:
- `processInsert(table, newData)`: Handle INSERT operations
- `processUpdate(table, oldData, newData)`: Handle UPDATE operations
- `processDelete(table, oldData)`: Handle DELETE operations
- `processEvent(event)`: Main routing function

**Features**:
- Event validation and parsing
- Error handling with retry capability
- Processing status tracking (success/failed)
- Return processing result for acknowledgment

#### 5d. Main Subscriber (utils/subscriber.js)
**Purpose**: Core replication stream consumer

**Architecture**:
1. **Connection Setup**:
   - Create replication connection using `pg` client
   - Connect with `replication: 'database'` option
   - Load last checkpoint LSN

2. **Stream Initialization**:
   - Start logical replication: `START_REPLICATION SLOT my_slot LOGICAL LSN`
   - Use `pgoutput` plugin with publication name
   - Resume from last checkpoint or beginning

3. **Message Processing Loop**:
   - Receive WAL messages via replication protocol
   - Decode using `pg-logical-replication` library
   - Parse change events (BEGIN, COMMIT, INSERT, UPDATE, DELETE, RELATION)
   - Route to processor for handling
   - Track LSN of processed messages

4. **Acknowledgment Flow**:
   - Batch events by transaction (BEGIN...COMMIT)
   - After successful processing of transaction, save checkpoint
   - Send feedback to PostgreSQL with confirmed LSN
   - On error, skip feedback to allow retry on restart

5. **Error Handling**:
   - Catch processing errors, log details
   - Continue stream or halt based on error type
   - Failed events can be retried on next restart (no LSN advance)

6. **Graceful Shutdown**:
   - Handle SIGINT/SIGTERM signals
   - Save final checkpoint before exit
   - Close replication connection cleanly

### 6. Top-Level Scripts

#### 6a. Data Seeding (setup-data.js)
**File**: `replica-stream/setup-data.js`

**Purpose**: Initialize database with sample data

Functions:
- Execute `scripts/01_setup_tables.sql` to create tables
- Insert sample data (users, orders, products)
- Display summary of created data
- Verify table creation and row counts

Usage: `node setup-data.js`

#### 6b. Replication Starter (start-copy.js)
**File**: `replica-stream/start-copy.js`

**Purpose**: Start logical replication and monitor status

Functions:
- Check if replication is configured (query `wal_level` setting)
- If not configured:
  - Execute `scripts/02_setup_replication.sql`
  - Display message: "PostgreSQL needs to be restarted. Run: docker-compose restart"
  - Exit and wait for user to restart
- If configured:
  - Initialize subscriber from `utils/subscriber.js`
  - Start replication stream
  - Display real-time replication status:
    - Current LSN position
    - Events processed count
    - Last checkpoint time
    - Replication lag (if applicable)
  - Monitor and log all processed events
  - Handle graceful shutdown

Usage: `node start-copy.js`

### 7. Documentation (README.md)
**File**: `replica-stream/README.md`

Comprehensive documentation:

**Sections**:
1. **Overview**: What this example demonstrates
2. **Prerequisites**:
   - Docker and Docker Compose installed
   - Node.js 16+ installed
3. **Setup**:
   - Start PostgreSQL: `docker-compose up -d`
   - Copy `.env.example` to `.env` (defaults work with docker-compose setup)
   - Run `npm install`
   - Run `node setup-data.js` to create tables and seed data
4. **Usage**:
   - Start replication: `node start-copy.js`
   - In another terminal, insert/update data in watched tables
   - Observe processed events and checkpoints in real-time
   - Stop PostgreSQL: `docker-compose down` (data persists in `./data` folder)
5. **Architecture**:
   - Explain logical replication flow
   - Describe acknowledge/checkpoint mechanism
   - LSN tracking and feedback protocol
6. **Retry Mechanism**:
   - How failed events are retried
   - Checkpoint prevents re-processing
   - Manual intervention options
7. **Troubleshooting**:
   - Common issues and solutions
   - Monitoring replication lag
   - Resetting replication slot

## Critical Implementation Details

### Replication Slot Feedback Protocol
PostgreSQL logical replication uses standby status messages:
- `write_lsn`: LSN written to local storage (not applicable for logical)
- `flush_lsn`: LSN flushed to disk (use for processed position)
- `apply_lsn`: LSN applied/processed
- Send periodic updates even if no new messages (keepalive)

In Node.js with `pg-logical-replication`:
```javascript
// After processing transaction successfully
await logicalClient.sendStandbyStatusUpdate(processedLSN);
```

### LSN Management
- LSN (Log Sequence Number) format: `'0/12A4560'` (segment/offset)
- Compare LSNs using PostgreSQL `pg_lsn` type or convert to numeric
- Store last confirmed LSN in checkpoint table
- On restart, resume from last checkpoint + 1

### Event Processing Guarantees
- **At-least-once delivery**: Events may be reprocessed on failure
- Idempotent processing recommended for handlers
- Use transaction boundaries (BEGIN/COMMIT) for batching
- Failed transactions don't advance checkpoint (will retry)

### Connection Configuration
```javascript
const client = new pg.Client({
  host: config.host,
  port: config.port,
  database: config.database,
  user: config.user,
  password: config.password,
  replication: 'database' // Enable logical replication mode
});
```

## Files to Create

### Top-Level Files
1. `replica-stream/package.json` - Dependencies and scripts
2. `replica-stream/.env.example` - Configuration template
3. `replica-stream/docker-compose.yml` - PostgreSQL database setup
4. `replica-stream/.gitignore` - Ignore data/, .env, node_modules/
5. `replica-stream/setup-data.js` - Data seeding script
6. `replica-stream/start-copy.js` - Start replication and monitor
7. `replica-stream/README.md` - Complete documentation (replace existing)

### SQL Scripts
8. `replica-stream/scripts/01_setup_tables.sql` - Create tables and insert data
9. `replica-stream/scripts/02_setup_replication.sql` - Configure replication

### Utilities
10. `replica-stream/utils/config.js` - Configuration loader
11. `replica-stream/utils/checkpoint.js` - LSN tracking module
12. `replica-stream/utils/processor.js` - Event processing logic
13. `replica-stream/utils/subscriber.js` - Main replication subscriber

**Total: 13 files**

## Success Criteria

- [ ] Node.js subscriber connects to PostgreSQL replication stream
- [ ] Successfully decodes and processes INSERT/UPDATE/DELETE events
- [ ] Checkpoint mechanism saves and resumes from last processed LSN
- [ ] Replication slot feedback prevents WAL accumulation
- [ ] Failed events can be retried on restart (no checkpoint advance)
- [ ] Graceful shutdown preserves checkpoint state
- [ ] Clear documentation for setup and usage
