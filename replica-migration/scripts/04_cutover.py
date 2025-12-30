"""
Automated cutover orchestration
Monitors replication sync, performs cutover when ready, validates post-cutover state
"""
import logging
import time
import sys
from typing import Tuple
from datetime import datetime
from pathlib import Path
from db_config import PRIMARY_CONFIG, REPLICA_CONFIG
from db_config import REPLICATION_LAG_THRESHOLD_BYTES, REPLICATION_LAG_THRESHOLD_SECONDS
from db_connection import DatabaseConnection
from utils import ReplicationMonitor

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class CutoverOrchestrator:
    """Orchestrates automated database cutover from primary to replica"""

    def __init__(self,
                 dry_run: bool = False,
                 max_wait_time: int = 300,
                 sync_check_interval: int = 5):
        self.dry_run = dry_run
        self.max_wait_time = max_wait_time
        self.sync_check_interval = sync_check_interval

        self.primary_db = DatabaseConnection(PRIMARY_CONFIG)
        self.replica_db = DatabaseConnection(REPLICA_CONFIG)
        self.monitor = ReplicationMonitor()

    def check_prerequisites(self) -> Tuple[bool, list]:
        """Check if system is ready for cutover"""
        logger.info("Checking cutover prerequisites...")
        issues = []

        # Check primary connectivity
        try:
            self.primary_db.execute_query("SELECT 1")
        except Exception as e:
            issues.append(f"Cannot connect to primary: {e}")

        # Check replica connectivity
        try:
            self.replica_db.execute_query("SELECT 1")
        except Exception as e:
            issues.append(f"Cannot connect to replica: {e}")

        # Check replication status
        metrics = self.monitor.collect_metrics()

        if not metrics.replica_is_in_recovery:
            issues.append("Replica is not in recovery mode")

        if metrics.replication_state != 'streaming':
            issues.append(f"Replication state is {metrics.replication_state}, expected 'streaming'")

        if not metrics.slot_active:
            issues.append("Replication slot is not active")

        is_ready = len(issues) == 0

        if is_ready:
            logger.info("✓ Prerequisites check passed")
        else:
            logger.error(f"✗ Prerequisites check failed: {len(issues)} issues found")
            for issue in issues:
                logger.error(f"  - {issue}")

        return is_ready, issues

    def wait_for_sync(self) -> bool:
        """Wait for replication to reach sync threshold"""
        logger.info(f"Waiting for replication sync (max {self.max_wait_time}s)...")
        logger.info(f"Thresholds: {REPLICATION_LAG_THRESHOLD_BYTES} bytes, {REPLICATION_LAG_THRESHOLD_SECONDS}s")

        start_time = time.time()
        consecutive_synced = 0
        required_consecutive = 3  # Must be synced for 3 consecutive checks

        while True:
            elapsed = time.time() - start_time

            if elapsed > self.max_wait_time:
                logger.error(f"✗ Sync wait timeout after {self.max_wait_time}s")
                return False

            # Check current sync status
            metrics = self.monitor.collect_metrics()

            byte_lag = metrics.byte_lag or 0
            replay_lag = metrics.replay_lag_seconds or 0

            is_synced = (
                byte_lag <= REPLICATION_LAG_THRESHOLD_BYTES and
                replay_lag <= REPLICATION_LAG_THRESHOLD_SECONDS
            )

            if is_synced:
                consecutive_synced += 1
                logger.info(
                    f"[{elapsed:.1f}s] ✓ IN SYNC ({consecutive_synced}/{required_consecutive}) - "
                    f"Byte lag: {byte_lag}B, Replay lag: {replay_lag:.3f}s"
                )

                if consecutive_synced >= required_consecutive:
                    logger.info("✓ Replication is consistently in sync!")
                    return True
            else:
                if consecutive_synced > 0:
                    logger.warning("○ Lost sync, resetting counter")
                consecutive_synced = 0
                logger.info(
                    f"[{elapsed:.1f}s] ○ NOT IN SYNC - "
                    f"Byte lag: {byte_lag}B, Replay lag: {replay_lag:.3f}s"
                )

            time.sleep(self.sync_check_interval)

    def stop_write_traffic(self) -> bool:
        """Signal to stop write traffic"""
        logger.info("Stopping write traffic to primary...")

        if self.dry_run:
            logger.info("[DRY RUN] Would stop write traffic here")
            return True

        logger.warning("⚠ In production, coordinate with application layer to stop writes")
        logger.info("Assuming writes have been stopped externally")

        return True

    def verify_final_sync(self) -> bool:
        """Final verification that replica is fully synced"""
        logger.info("Performing final sync verification...")

        # Wait a moment for any final WAL to be replayed
        time.sleep(2)

        metrics = self.monitor.collect_metrics()

        byte_lag = metrics.byte_lag or 0
        replay_lag = metrics.replay_lag_seconds or 0

        if byte_lag == 0 and replay_lag < 0.1:
            logger.info("✓ Final sync verification passed")
            logger.info(f"  Byte lag: {byte_lag}B, Replay lag: {replay_lag:.3f}s")
            return True
        else:
            logger.error("✗ Final sync verification failed")
            logger.error(f"  Byte lag: {byte_lag}B, Replay lag: {replay_lag:.3f}s")
            return False

    def promote_replica(self) -> bool:
        """Promote replica to primary"""
        logger.info("Promoting replica to primary...")

        if self.dry_run:
            logger.info("[DRY RUN] Would promote replica here")
            return True

        try:
            # Use SQL function to promote replica
            promote_query = "SELECT pg_promote()"
            self.replica_db.execute_query(promote_query, fetch=False)

            logger.info("Promotion command issued")

            # Wait for promotion to complete
            max_wait = 30
            start = time.time()

            while time.time() - start < max_wait:
                # Check if replica is still in recovery
                result = self.replica_db.execute_query("SELECT pg_is_in_recovery()")
                is_in_recovery = result[0]['pg_is_in_recovery']

                if not is_in_recovery:
                    logger.info("✓ Replica successfully promoted to primary!")
                    return True

                logger.info("  Waiting for promotion to complete...")
                time.sleep(1)

            logger.error("✗ Promotion timeout")
            return False

        except Exception as e:
            logger.error(f"✗ Promotion failed: {e}")
            return False

    def validate_new_primary(self) -> bool:
        """Validate that new primary is accepting writes"""
        logger.info("Validating new primary...")

        try:
            # Check that it's not in recovery
            result = self.replica_db.execute_query("SELECT pg_is_in_recovery()")
            is_in_recovery = result[0]['pg_is_in_recovery']

            if is_in_recovery:
                logger.error("✗ New primary is still in recovery mode")
                return False

            # Try a test write
            test_query = """
            INSERT INTO audit_log (table_name, record_id, action, changed_data)
            VALUES ('cutover_test', 0, 'CUTOVER_VALIDATION', ('{"timestamp": "' || NOW()::text || '"}')::jsonb)
            """

            if self.dry_run:
                logger.info("[DRY RUN] Would test write to new primary")
            else:
                self.replica_db.execute_query(test_query, fetch=False)
                logger.info("✓ Test write successful")

            # Check database statistics
            stats = self.replica_db.execute_query("""
                SELECT
                    (SELECT COUNT(*) FROM users) as users,
                    (SELECT COUNT(*) FROM products) as products,
                    (SELECT COUNT(*) FROM orders) as orders
            """)

            logger.info(f"New primary database statistics: {dict(stats[0])}")
            logger.info("✓ New primary validation passed")
            return True

        except Exception as e:
            logger.error(f"✗ New primary validation failed: {e}")
            return False

    def demote_old_primary(self) -> bool:
        """Demote old primary (make it read-only)"""
        logger.info("Demoting old primary...")

        if self.dry_run:
            logger.info("[DRY RUN] Would demote old primary here")
            return True

        try:
            # Set database to read-only mode
            readonly_query = "ALTER SYSTEM SET default_transaction_read_only = on"
            self.primary_db.execute_query(readonly_query, fetch=False)

            # Reload configuration
            self.primary_db.execute_query("SELECT pg_reload_conf()", fetch=False)

            logger.info("✓ Old primary set to read-only mode")
            return True

        except Exception as e:
            logger.error(f"✗ Old primary demotion failed: {e}")
            return False

    def generate_cutover_report(self, success: bool, start_time: datetime, end_time: datetime):
        """Generate detailed cutover report"""
        duration = (end_time - start_time).total_seconds()

        report = [
            "\n" + "="*80,
            "CUTOVER REPORT",
            "="*80,
            f"Status: {'✓ SUCCESS' if success else '✗ FAILED'}",
            f"Start Time: {start_time.isoformat()}",
            f"End Time: {end_time.isoformat()}",
            f"Duration: {duration:.2f} seconds",
            f"Dry Run: {self.dry_run}",
            "",
            "Final Metrics:",
        ]

        # Get final metrics
        try:
            metrics = self.monitor.collect_metrics()
            report.extend([
                f"  Replica in Recovery: {metrics.replica_is_in_recovery}",
                f"  Byte Lag: {metrics.byte_lag}",
                f"  Replay Lag: {metrics.replay_lag_seconds}s",
                f"  Replication State: {metrics.replication_state}",
            ])
        except Exception as e:
            report.append(f"  Could not fetch final metrics: {e}")

        report.append("="*80 + "\n")

        report_text = "\n".join(report)
        print(report_text)

        # Save report
        try:
            log_dir = Path(__file__).parent.parent / 'logs' / 'monitoring'
            log_dir.mkdir(parents=True, exist_ok=True)
            report_file = log_dir / f"cutover_report_{start_time.strftime('%Y%m%d_%H%M%S')}.txt"

            with open(report_file, 'w') as f:
                f.write(report_text)
            logger.info(f"Report saved to {report_file}")
        except Exception as e:
            logger.error(f"Could not save report: {e}")

    def execute_cutover(self) -> bool:
        """Execute complete cutover process"""
        logger.info("="*80)
        logger.info("STARTING CUTOVER PROCESS")
        if self.dry_run:
            logger.info("⚠ DRY RUN MODE - No actual changes will be made")
        logger.info("="*80)

        start_time = datetime.now()
        success = False

        try:
            # Step 1: Prerequisites check
            logger.info("\n▶ Step 1: Checking prerequisites...")
            prereqs_ok, issues = self.check_prerequisites()
            if not prereqs_ok:
                logger.error("Prerequisites check failed, aborting cutover")
                return False

            # Step 2: Wait for sync
            logger.info("\n▶ Step 2: Waiting for replication sync...")
            if not self.wait_for_sync():
                logger.error("Failed to achieve replication sync, aborting cutover")
                return False

            # Step 3: Stop write traffic
            logger.info("\n▶ Step 3: Stopping write traffic...")
            if not self.stop_write_traffic():
                logger.error("Failed to stop write traffic, aborting cutover")
                return False

            # Step 4: Final sync verification
            logger.info("\n▶ Step 4: Final sync verification...")
            if not self.verify_final_sync():
                logger.error("Final sync verification failed, aborting cutover")
                return False

            # Step 5: Promote replica
            logger.info("\n▶ Step 5: Promoting replica to primary...")
            if not self.promote_replica():
                logger.error("Replica promotion failed, aborting cutover")
                return False

            # Step 6: Validate new primary
            logger.info("\n▶ Step 6: Validating new primary...")
            if not self.validate_new_primary():
                logger.error("New primary validation failed")
                return False

            # Step 7: Demote old primary
            logger.info("\n▶ Step 7: Demoting old primary...")
            if not self.demote_old_primary():
                logger.warning("Old primary demotion had issues (non-fatal)")

            success = True
            logger.info("\n" + "="*80)
            logger.info("✓ CUTOVER COMPLETED SUCCESSFULLY!")
            logger.info("="*80)

            return True

        except Exception as e:
            logger.error(f"✗ Cutover failed with exception: {e}")
            return False

        finally:
            end_time = datetime.now()
            self.generate_cutover_report(success, start_time, end_time)

            self.primary_db.close_pool()
            self.replica_db.close_pool()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="PostgreSQL Automated Cutover")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Perform dry run without making actual changes"
    )
    parser.add_argument(
        "--max-wait-time",
        type=int,
        default=300,
        help="Maximum time to wait for sync in seconds (default: 300)"
    )
    parser.add_argument(
        "--sync-check-interval",
        type=int,
        default=5,
        help="Interval between sync checks in seconds (default: 5)"
    )

    args = parser.parse_args()

    orchestrator = CutoverOrchestrator(
        dry_run=args.dry_run,
        max_wait_time=args.max_wait_time,
        sync_check_interval=args.sync_check_interval
    )

    success = orchestrator.execute_cutover()
    sys.exit(0 if success else 1)
