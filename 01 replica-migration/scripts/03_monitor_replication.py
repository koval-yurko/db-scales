"""
Monitors PostgreSQL replication status and lag metrics
Tracks WAL positions, byte lag, time lag, and replication health
"""
from utils import ReplicationMonitor


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="PostgreSQL Replication Monitor")
    parser.add_argument(
        "--duration",
        type=int,
        default=None,
        help="Monitoring duration in seconds (default: infinite)"
    )
    parser.add_argument(
        "--no-save",
        action="store_true",
        help="Don't save metrics to file"
    )

    args = parser.parse_args()

    monitor = ReplicationMonitor()
    monitor.monitor(duration_seconds=args.duration, save_to_file=not args.no_save)
