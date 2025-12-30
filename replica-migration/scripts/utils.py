"""
Shared utilities for replication monitoring
Contains ReplicationMetrics dataclass, DecimalEncoder, and ReplicationMonitor class
"""
import logging
import time
import json
from datetime import datetime
from decimal import Decimal
from typing import Optional
from dataclasses import dataclass, asdict
from pathlib import Path
from db_config import PRIMARY_CONFIG, REPLICA_CONFIG, MONITORING_INTERVAL_SECONDS
from db_connection import DatabaseConnection

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class DecimalEncoder(json.JSONEncoder):
    """Custom JSON encoder to handle Decimal types from PostgreSQL"""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super(DecimalEncoder, self).default(obj)


@dataclass
class ReplicationMetrics:
    """Container for replication metrics"""
    timestamp: str

    # Primary metrics
    primary_wal_lsn: Optional[str]
    primary_wal_position_bytes: Optional[int]

    # Replica metrics
    replica_is_in_recovery: Optional[bool]
    replica_last_wal_receive_lsn: Optional[str]
    replica_last_wal_replay_lsn: Optional[str]

    # Lag metrics
    sent_lsn: Optional[str]
    write_lsn: Optional[str]
    flush_lsn: Optional[str]
    replay_lsn: Optional[str]

    write_lag_seconds: Optional[float]
    flush_lag_seconds: Optional[float]
    replay_lag_seconds: Optional[float]

    byte_lag: Optional[int]

    # Replication slot info
    slot_name: Optional[str]
    slot_active: Optional[bool]

    # Connection state
    replication_state: Optional[str]
    sync_state: Optional[str]

    # Health indicators
    is_healthy: bool
    is_in_sync: bool
    warnings: list


class ReplicationMonitor:
    """Monitors PostgreSQL replication health and lag"""

    def __init__(self):
        self.primary_db = DatabaseConnection(PRIMARY_CONFIG)
        self.replica_db = DatabaseConnection(REPLICA_CONFIG)
        self.metrics_history = []

    def get_primary_wal_position(self) -> dict:
        """Get current WAL position on primary"""
        query = """
        SELECT
            pg_current_wal_lsn() as current_wal_lsn,
            pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0') as wal_position_bytes
        """
        result = self.primary_db.execute_query(query)
        return result[0] if result else {}

    def get_replication_stats(self) -> dict:
        """Get replication statistics from primary's pg_stat_replication"""
        query = """
        SELECT
            application_name,
            state,
            sent_lsn,
            write_lsn,
            flush_lsn,
            replay_lsn,
            sync_state,
            EXTRACT(EPOCH FROM write_lag) as write_lag_seconds,
            EXTRACT(EPOCH FROM flush_lag) as flush_lag_seconds,
            EXTRACT(EPOCH FROM replay_lag) as replay_lag_seconds,
            pg_wal_lsn_diff(sent_lsn, replay_lsn) as byte_lag
        FROM pg_stat_replication
        WHERE application_name = 'replica1'
        """
        result = self.primary_db.execute_query(query)
        return result[0] if result else {}

    def get_replication_slots(self) -> dict:
        """Get replication slot information"""
        query = """
        SELECT
            slot_name,
            active,
            restart_lsn,
            confirmed_flush_lsn,
            pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) as retained_bytes
        FROM pg_replication_slots
        WHERE slot_name = 'replica_slot'
        """
        result = self.primary_db.execute_query(query)
        return result[0] if result else {}

    def check_replica_status(self) -> dict:
        """Check if replica is in recovery mode and get recovery info"""
        query = """
        SELECT
            pg_is_in_recovery() as is_in_recovery,
            CASE
                WHEN pg_is_in_recovery() THEN pg_last_wal_receive_lsn()
                ELSE NULL
            END as last_wal_receive_lsn,
            CASE
                WHEN pg_is_in_recovery() THEN pg_last_wal_replay_lsn()
                ELSE NULL
            END as last_wal_replay_lsn,
            CASE
                WHEN pg_is_in_recovery() THEN
                    pg_wal_lsn_diff(pg_last_wal_receive_lsn(), pg_last_wal_replay_lsn())
                ELSE NULL
            END as receive_replay_lag_bytes
        """
        try:
            result = self.replica_db.execute_query(query)
            return result[0] if result else {}
        except Exception as e:
            logger.warning(f"Could not query replica: {e}")
            return {'is_in_recovery': None}

    def collect_metrics(self) -> ReplicationMetrics:
        """Collect all replication metrics"""
        warnings = []

        # Get metrics from both sides
        primary_wal = self.get_primary_wal_position()
        replication_stats = self.get_replication_stats()
        replication_slots = self.get_replication_slots()
        replica_status = self.check_replica_status()

        # Check if replication is active
        if not replication_stats:
            warnings.append("No active replication connection found")

        # Extract byte lag
        byte_lag = replication_stats.get('byte_lag')
        if byte_lag and byte_lag > 1024 * 1024:  # > 1MB
            warnings.append(f"High byte lag: {byte_lag / (1024*1024):.2f} MB")

        # Extract time lags
        replay_lag = replication_stats.get('replay_lag_seconds')
        if replay_lag and replay_lag > 5.0:  # > 5 seconds
            warnings.append(f"High replay lag: {replay_lag:.2f} seconds")

        # Check slot status
        slot_active = replication_slots.get('active')
        if not slot_active:
            warnings.append("Replication slot is not active")

        # Determine health and sync status
        is_healthy = (
            len(warnings) == 0 and
            replication_stats.get('state') == 'streaming' and
            replica_status.get('is_in_recovery') == True
        )

        is_in_sync = (
            is_healthy and
            (byte_lag is None or byte_lag < 1024) and  # < 1KB
            (replay_lag is None or replay_lag < 1.0)    # < 1 second
        )

        # Build metrics object
        metrics = ReplicationMetrics(
            timestamp=datetime.now().isoformat(),

            primary_wal_lsn=primary_wal.get('current_wal_lsn'),
            primary_wal_position_bytes=primary_wal.get('wal_position_bytes'),

            replica_is_in_recovery=replica_status.get('is_in_recovery'),
            replica_last_wal_receive_lsn=replica_status.get('last_wal_receive_lsn'),
            replica_last_wal_replay_lsn=replica_status.get('last_wal_replay_lsn'),

            sent_lsn=replication_stats.get('sent_lsn'),
            write_lsn=replication_stats.get('write_lsn'),
            flush_lsn=replication_stats.get('flush_lsn'),
            replay_lsn=replication_stats.get('replay_lsn'),

            write_lag_seconds=replication_stats.get('write_lag_seconds'),
            flush_lag_seconds=replication_stats.get('flush_lag_seconds'),
            replay_lag_seconds=replication_stats.get('replay_lag_seconds'),

            byte_lag=byte_lag,

            slot_name=replication_slots.get('slot_name'),
            slot_active=slot_active,

            replication_state=replication_stats.get('state'),
            sync_state=replication_stats.get('sync_state'),

            is_healthy=is_healthy,
            is_in_sync=is_in_sync,
            warnings=warnings
        )

        return metrics

    def format_metrics_display(self, metrics: ReplicationMetrics) -> str:
        """Format metrics for console display"""
        status_emoji = "✓" if metrics.is_healthy else "✗"
        sync_emoji = "✓" if metrics.is_in_sync else "○"

        output = [
            f"\n{'='*80}",
            f"Replication Monitor - {metrics.timestamp}",
            f"{'='*80}",
            f"Status: {status_emoji} {'HEALTHY' if metrics.is_healthy else 'UNHEALTHY'}",
            f"In Sync: {sync_emoji} {'YES' if metrics.is_in_sync else 'NO'}",
            f"",
            f"Primary WAL Position: {metrics.primary_wal_lsn}",
            f"Primary WAL Bytes: {metrics.primary_wal_position_bytes:,}" if metrics.primary_wal_position_bytes else "Primary WAL Bytes: N/A",
            f"",
            f"Replica in Recovery: {metrics.replica_is_in_recovery}",
            f"Replica Receive LSN: {metrics.replica_last_wal_receive_lsn}",
            f"Replica Replay LSN: {metrics.replica_last_wal_replay_lsn}",
            f"",
            f"Replication State: {metrics.replication_state}",
            f"Sync State: {metrics.sync_state}",
            f"",
            f"Lag Metrics:",
            f"  Byte Lag: {self.format_bytes(metrics.byte_lag)}",
            f"  Write Lag: {self.format_seconds(metrics.write_lag_seconds)}",
            f"  Flush Lag: {self.format_seconds(metrics.flush_lag_seconds)}",
            f"  Replay Lag: {self.format_seconds(metrics.replay_lag_seconds)}",
            f"",
            f"Replication Slot: {metrics.slot_name} ({'active' if metrics.slot_active else 'inactive'})",
        ]

        if metrics.warnings:
            output.append(f"\nWarnings:")
            for warning in metrics.warnings:
                output.append(f"  ! {warning}")

        output.append(f"{'='*80}\n")

        return "\n".join(output)

    def format_bytes(self, bytes_val: Optional[int]) -> str:
        """Format bytes for display"""
        if bytes_val is None:
            return "N/A"

        if bytes_val < 1024:
            return f"{bytes_val} B"
        elif bytes_val < 1024 * 1024:
            return f"{bytes_val / 1024:.2f} KB"
        elif bytes_val < 1024 * 1024 * 1024:
            return f"{bytes_val / (1024 * 1024):.2f} MB"
        else:
            return f"{bytes_val / (1024 * 1024 * 1024):.2f} GB"

    def format_seconds(self, seconds: Optional[float]) -> str:
        """Format seconds for display"""
        if seconds is None:
            return "N/A"

        if seconds < 1:
            return f"{seconds * 1000:.0f} ms"
        elif seconds < 60:
            return f"{seconds:.2f} s"
        else:
            return f"{seconds / 60:.2f} min"

    def save_metrics_to_file(self, metrics: ReplicationMetrics):
        """Save metrics to JSON Lines file"""
        log_dir = Path(__file__).parent.parent / 'logs' / 'monitoring'
        log_dir.mkdir(parents=True, exist_ok=True)
        filepath = log_dir / 'metrics.jsonl'

        try:
            with open(filepath, 'a') as f:
                f.write(json.dumps(asdict(metrics), cls=DecimalEncoder) + '\n')
        except Exception as e:
            logger.error(f"Failed to save metrics: {e}")

    def monitor(self, duration_seconds: Optional[int] = None, save_to_file: bool = True):
        """Run monitoring loop"""
        logger.info("Starting replication monitoring...")

        start_time = time.time()
        iteration = 0

        try:
            while True:
                iteration += 1

                # Collect metrics
                metrics = self.collect_metrics()

                # Display
                print(self.format_metrics_display(metrics))

                # Save to file
                if save_to_file:
                    self.save_metrics_to_file(metrics)

                # Store in memory
                self.metrics_history.append(metrics)

                # Check if we should stop
                if duration_seconds and (time.time() - start_time) >= duration_seconds:
                    logger.info(f"Monitoring duration reached ({duration_seconds}s)")
                    break

                # Wait for next iteration
                time.sleep(MONITORING_INTERVAL_SECONDS)

        except KeyboardInterrupt:
            logger.info("Monitoring stopped by user")
        except Exception as e:
            logger.error(f"Monitoring failed: {e}")
            raise
        finally:
            self.primary_db.close_pool()
            self.replica_db.close_pool()
            logger.info(f"Monitoring completed. Total iterations: {iteration}")

