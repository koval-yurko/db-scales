#!/bin/bash
set -e

echo "=== Custom Replica Entrypoint ==="

# Check if data directory needs initialization
if [ ! -f /var/lib/postgresql/data/PG_VERSION ]; then
    echo "PostgreSQL not initialized. Setting up replica from primary..."

    # Wait for primary to be ready
    echo "Waiting for primary database to be ready..."
    until PGPASSWORD=$POSTGRES_REPLICATION_PASSWORD psql -h pg-primary -U $POSTGRES_REPLICATION_USER -d postgres -c '\q' 2>/dev/null; do
        echo "Primary not ready yet, waiting..."
        sleep 2
    done
    echo "Primary is ready!"

    # Create base backup from primary
    echo "Creating base backup from primary using pg_basebackup..."
    PGPASSWORD=$POSTGRES_REPLICATION_PASSWORD pg_basebackup \
        -h pg-primary \
        -D /var/lib/postgresql/data \
        -U $POSTGRES_REPLICATION_USER \
        -v \
        -P \
        -X stream \
        -c fast \
        -R \
        -S replica_slot

    echo "Base backup complete!"

    # Ensure standby.signal exists (pg_basebackup -R should create it)
    if [ ! -f /var/lib/postgresql/data/standby.signal ]; then
        echo "Creating standby.signal file..."
        touch /var/lib/postgresql/data/standby.signal
    fi

    # Ensure replication settings in postgresql.auto.conf
    echo "Configuring replication settings..."
    cat > /var/lib/postgresql/data/postgresql.auto.conf <<EOF
# Replication Configuration
primary_conninfo = 'host=pg-primary port=5432 user=$POSTGRES_REPLICATION_USER password=$POSTGRES_REPLICATION_PASSWORD application_name=replica1'
primary_slot_name = 'replica_slot'
EOF

    echo "Replica initialization complete!"
else
    echo "PostgreSQL already initialized."

    # Verify it's configured as a replica
    if [ ! -f /var/lib/postgresql/data/standby.signal ]; then
        echo "WARNING: This instance is NOT configured as a replica!"
        echo "standby.signal file is missing."
    else
        echo "Replica configuration verified."
    fi
fi

echo "=== Starting PostgreSQL with custom configuration ==="

# Execute the original docker entrypoint with all arguments
exec docker-entrypoint.sh "$@"
