"""
Database connection utilities with retry logic and connection pooling
"""
import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2.pool import SimpleConnectionPool
import time
from typing import Optional, Any
import logging

logger = logging.getLogger(__name__)


class DatabaseConnection:
    """Manages database connections with pooling and retry logic"""

    def __init__(self, config, pool_size: int = 5):
        """
        Initialize database connection manager

        Args:
            config: DatabaseConfig instance
            pool_size: Maximum number of connections in pool
        """
        self.config = config
        self.pool: Optional[SimpleConnectionPool] = None
        self.pool_size = pool_size

    def initialize_pool(self, max_retries: int = 5, retry_delay: int = 2):
        """
        Initialize connection pool with retry logic

        Args:
            max_retries: Maximum number of connection attempts
            retry_delay: Seconds to wait between retries
        """
        for attempt in range(max_retries):
            try:
                self.pool = SimpleConnectionPool(
                    1,
                    self.pool_size,
                    host=self.config.host,
                    port=self.config.port,
                    database=self.config.database,
                    user=self.config.user,
                    password=self.config.password
                )
                logger.info(f"Connection pool initialized for {self.config.host}:{self.config.port}")
                return
            except psycopg2.OperationalError as e:
                if attempt < max_retries - 1:
                    logger.warning(
                        f"Connection attempt {attempt + 1}/{max_retries} failed, "
                        f"retrying in {retry_delay}s... Error: {e}"
                    )
                    time.sleep(retry_delay)
                else:
                    logger.error(f"Failed to connect after {max_retries} attempts")
                    raise

    def get_connection(self):
        """Get a connection from the pool"""
        if not self.pool:
            self.initialize_pool()
        return self.pool.getconn()

    def return_connection(self, conn):
        """Return connection to pool"""
        if self.pool:
            self.pool.putconn(conn)

    def execute_query(
        self,
        query: str,
        params: Optional[tuple] = None,
        fetch: bool = True
    ) -> Optional[list]:
        """
        Execute a query with automatic connection management

        Args:
            query: SQL query to execute
            params: Query parameters
            fetch: Whether to fetch and return results

        Returns:
            List of results (as dicts) if fetch=True, None otherwise
        """
        conn = None
        try:
            conn = self.get_connection()
            with conn.cursor(cursor_factory=RealDictCursor) as cursor:
                cursor.execute(query, params)
                if fetch:
                    return cursor.fetchall()
                conn.commit()
                return None
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Query execution failed: {e}")
            raise
        finally:
            if conn:
                self.return_connection(conn)

    def close_pool(self):
        """Close all connections in pool"""
        if self.pool:
            self.pool.closeall()
            logger.info("Connection pool closed")
