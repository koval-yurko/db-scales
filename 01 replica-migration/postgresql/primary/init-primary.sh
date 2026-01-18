#!/bin/bash
set -e

echo "Initializing PostgreSQL primary for replication..."

# Create replication user with REPLICATION privilege
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Create replication user
    DO \$\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$POSTGRES_REPLICATION_USER') THEN
            CREATE USER $POSTGRES_REPLICATION_USER REPLICATION LOGIN ENCRYPTED PASSWORD '$POSTGRES_REPLICATION_PASSWORD';
            RAISE NOTICE 'Replication user created: $POSTGRES_REPLICATION_USER';
        ELSE
            RAISE NOTICE 'Replication user already exists: $POSTGRES_REPLICATION_USER';
        END IF;
    END
    \$\$;

    -- Create physical replication slot
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = 'replica_slot')
        THEN 'Replication slot already exists'
        ELSE pg_create_physical_replication_slot('replica_slot')::text
    END;
EOSQL

# Create archive directory
mkdir -p /var/lib/postgresql/archive
chown -R postgres:postgres /var/lib/postgresql/archive

echo "Primary initialization complete!"
echo "Replication user: $POSTGRES_REPLICATION_USER"
echo "Replication slot: replica_slot"
