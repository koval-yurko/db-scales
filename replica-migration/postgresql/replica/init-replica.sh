#!/bin/bash
set -e

echo "Initializing PostgreSQL replica from primary..."

# This script runs on first startup when data directory is empty
if [ -z "$(ls -A /var/lib/postgresql/data)" ]; then
    echo "Data directory is empty, creating base backup from primary..."

    # Wait for primary to be ready
    echo "Waiting for primary database to be ready..."
    until PGPASSWORD=$POSTGRES_REPLICATION_PASSWORD psql -h pg-primary -U replicator -d postgres -c '\q' 2>/dev/null; do
        echo "Primary not ready yet, waiting..."
        sleep 2
    done
    echo "Primary is ready!"

    # Remove any existing data
    rm -rf /var/lib/postgresql/data/*

    # Create base backup from primary
    echo "Starting pg_basebackup..."
    PGPASSWORD=$POSTGRES_REPLICATION_PASSWORD pg_basebackup \
        -h pg-primary \
        -D /var/lib/postgresql/data \
        -U replicator \
        -v \
        -P \
        -X stream \
        -c fast \
        -R \
        -S replica_slot

    echo "Base backup complete!"

    # Create standby.signal file (pg_basebackup -R should do this, but let's be explicit)
    touch /var/lib/postgresql/data/standby.signal

    # Set primary connection info in postgresql.auto.conf
    cat >> /var/lib/postgresql/data/postgresql.auto.conf <<EOF
primary_conninfo = 'host=pg-primary port=5432 user=replicator password=$POSTGRES_REPLICATION_PASSWORD application_name=replica1'
primary_slot_name = 'replica_slot'
promote_trigger_file = '/tmp/promote_trigger'
EOF

    echo "Replica initialized successfully!"
    echo "Replication will start when PostgreSQL starts"
else
    echo "Data directory not empty, skipping initialization"
fi
