# PostgreSQL Logical Replication - Implementation Tasks

## Overview
Implementing a PostgreSQL Logical Replication example with Node.js subscriber that processes database changes and uses replication slot feedback for acknowledgment.

## Implementation Checklist

### Phase 1: Project Setup
- [ ] Create `package.json` with dependencies (pg, dotenv, pg-logical-replication)
- [ ] Create `.env.example` with configuration template
- [ ] Create `docker-compose.yml` for PostgreSQL database
- [ ] Create `.gitignore` to ignore data/, .env, node_modules/

### Phase 2: SQL Scripts
- [ ] Create `scripts/01_setup_tables.sql`
  - [ ] Define `users` table with sample schema
  - [ ] Define `orders` table with sample schema
  - [ ] Define `products` table with sample schema
  - [ ] Create indexes for performance
  - [ ] Insert sample data (10 users, 20 orders, products)
- [ ] Create `scripts/02_setup_replication.sql`
  - [ ] Add `ALTER SYSTEM` commands for logical replication config
  - [ ] Add verification query for `wal_level`
  - [ ] Create publication for tables
  - [ ] Create replication slot
  - [ ] Create checkpoint tracking table
  - [ ] Add permission grants

### Phase 3: Utilities (utils/)
- [ ] Create `utils/config.js`
  - [ ] Load environment variables with dotenv
  - [ ] Validate required configuration
  - [ ] Export config object
- [ ] Create `utils/checkpoint.js`
  - [ ] Implement `loadLastCheckpoint()` - read from tracking table
  - [ ] Implement `saveCheckpoint(lsn)` - store LSN with timestamp
  - [ ] Implement `sendFeedback(lsn)` - send standby status update
  - [ ] Implement `getCheckpointStatus()` - get current checkpoint info
- [ ] Create `utils/processor.js`
  - [ ] Implement `processInsert(table, newData)` handler
  - [ ] Implement `processUpdate(table, oldData, newData)` handler
  - [ ] Implement `processDelete(table, oldData)` handler
  - [ ] Implement `processEvent(event)` main routing function
  - [ ] Add error handling and retry capability
- [ ] Create `utils/subscriber.js`
  - [ ] Implement connection setup with replication mode
  - [ ] Implement stream initialization (START_REPLICATION command)
  - [ ] Implement message processing loop
  - [ ] Integrate pg-logical-replication decoder
  - [ ] Implement acknowledgment flow (transaction batching)
  - [ ] Add error handling for failed events
  - [ ] Add graceful shutdown (SIGINT/SIGTERM handlers)

### Phase 4: Top-Level Scripts
- [ ] Create `setup-data.js`
  - [ ] Connect to PostgreSQL
  - [ ] Execute `scripts/01_setup_tables.sql`
  - [ ] Display summary of created tables and row counts
  - [ ] Handle errors gracefully
- [ ] Create `start-copy.js`
  - [ ] Connect to PostgreSQL
  - [ ] Check if replication is configured (query wal_level)
  - [ ] If not configured:
    - [ ] Execute `scripts/02_setup_replication.sql`
    - [ ] Display restart message to user
    - [ ] Exit gracefully
  - [ ] If configured:
    - [ ] Initialize subscriber
    - [ ] Start replication stream
    - [ ] Display real-time status (LSN, events count, checkpoint time)
    - [ ] Log all processed events
    - [ ] Handle graceful shutdown

### Phase 5: Documentation
- [ ] Create `README.md`
  - [ ] Write overview section
  - [ ] Document prerequisites (Docker, Node.js)
  - [ ] Write setup instructions
  - [ ] Write usage instructions
  - [ ] Explain architecture and LSN tracking
  - [ ] Document retry mechanism
  - [ ] Add troubleshooting section

### Phase 6: Testing & Validation
- [ ] Test Docker Compose setup
  - [ ] Verify PostgreSQL starts correctly
  - [ ] Verify data persistence in ./data folder
- [ ] Test setup-data.js
  - [ ] Verify tables are created
  - [ ] Verify sample data is inserted
- [ ] Test replication configuration
  - [ ] Run start-copy.js first time (should show restart message)
  - [ ] Restart PostgreSQL with docker-compose restart
  - [ ] Verify wal_level is set to 'logical'
- [ ] Test replication stream
  - [ ] Start subscriber with start-copy.js
  - [ ] Insert new data in another terminal
  - [ ] Verify events are processed
  - [ ] Verify checkpoint is saved
- [ ] Test checkpoint/resume
  - [ ] Stop subscriber (Ctrl+C)
  - [ ] Insert more data
  - [ ] Restart subscriber
  - [ ] Verify it resumes from last checkpoint
- [ ] Test error handling
  - [ ] Simulate processing error
  - [ ] Verify event is retried on restart
  - [ ] Verify checkpoint is not advanced on error

## Success Criteria
- [ ] Node.js subscriber connects to PostgreSQL replication stream
- [ ] Successfully decodes and processes INSERT/UPDATE/DELETE events
- [ ] Checkpoint mechanism saves and resumes from last processed LSN
- [ ] Replication slot feedback prevents WAL accumulation
- [ ] Failed events can be retried on restart (no checkpoint advance)
- [ ] Graceful shutdown preserves checkpoint state
- [ ] Clear documentation for setup and usage

## Files to Create (Total: 13)
1. `package.json`
2. `.env.example`
3. `docker-compose.yml`
4. `.gitignore`
5. `setup-data.js`
6. `start-copy.js`
7. `README.md`
8. `scripts/01_setup_tables.sql`
9. `scripts/02_setup_replication.sql`
10. `utils/config.js`
11. `utils/checkpoint.js`
12. `utils/processor.js`
13. `utils/subscriber.js`
