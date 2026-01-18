"""
Centralized database configuration and connection parameters
"""
import os
from dataclasses import dataclass
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
env_path = Path(__file__).parent.parent / '.env'
if env_path.exists():
    load_dotenv(env_path)

@dataclass
class DatabaseConfig:
    """Database connection configuration"""
    host: str
    port: int
    database: str
    user: str
    password: str

    @property
    def connection_string(self) -> str:
        """Get PostgreSQL connection string"""
        return f"postgresql://{self.user}:{self.password}@{self.host}:{self.port}/{self.database}"

# Configuration for primary database
PRIMARY_CONFIG = DatabaseConfig(
    host=os.getenv("PRIMARY_HOST", "localhost"),
    port=int(os.getenv("PRIMARY_PORT", "5432")),
    database=os.getenv("POSTGRES_DB", "testdb"),
    user=os.getenv("POSTGRES_USER", "postgres"),
    password=os.getenv("POSTGRES_PASSWORD", "postgres")
)

# Configuration for replica database
REPLICA_CONFIG = DatabaseConfig(
    host=os.getenv("REPLICA_HOST", "localhost"),
    port=int(os.getenv("REPLICA_PORT", "5433")),
    database=os.getenv("POSTGRES_DB", "testdb"),
    user=os.getenv("POSTGRES_USER", "postgres"),
    password=os.getenv("POSTGRES_PASSWORD", "postgres")
)

# Monitoring thresholds
REPLICATION_LAG_THRESHOLD_BYTES = int(os.getenv("LAG_THRESHOLD_BYTES", "1024"))  # 1KB default
REPLICATION_LAG_THRESHOLD_SECONDS = float(os.getenv("LAG_THRESHOLD_SECONDS", "1.0"))  # 1s default
MONITORING_INTERVAL_SECONDS = int(os.getenv("MONITORING_INTERVAL", "5"))  # 5s default

# Write load configuration
WRITE_OPERATIONS_PER_SECOND = int(os.getenv("WRITE_OPERATIONS_PER_SECOND", "100"))
