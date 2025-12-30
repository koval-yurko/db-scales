"""
Simulates high write load with mixed operations
Generates realistic INSERT, UPDATE, DELETE traffic patterns
"""
import logging
import random
import time
import signal
import sys
import json
from datetime import datetime
from threading import Thread, Event
from faker import Faker
from db_config import PRIMARY_CONFIG, WRITE_OPERATIONS_PER_SECOND
from db_connection import DatabaseConnection

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

fake = Faker()


class WriteLoadSimulator:
    """Simulates high write load with mixed operations"""

    def __init__(self, operations_per_second: int = 100):
        self.db = DatabaseConnection(PRIMARY_CONFIG, pool_size=10)
        self.operations_per_second = operations_per_second
        self.stop_event = Event()
        self.stats = {
            'inserts': 0,
            'updates': 0,
            'deletes': 0,
            'errors': 0
        }

    def get_random_user_id(self):
        """Get a random active user ID"""
        result = self.db.execute_query(
            "SELECT id FROM users WHERE is_active = TRUE ORDER BY RANDOM() LIMIT 1"
        )
        return result[0]['id'] if result else None

    def get_random_product_id(self):
        """Get a random product ID"""
        result = self.db.execute_query(
            "SELECT id FROM products ORDER BY RANDOM() LIMIT 1"
        )
        return result[0]['id'] if result else None

    def get_random_order_id(self):
        """Get a random order ID"""
        result = self.db.execute_query(
            "SELECT id FROM orders ORDER BY RANDOM() LIMIT 1"
        )
        return result[0]['id'] if result else None

    def insert_operations(self):
        """Various insert operations"""
        operations = [
            self.insert_user,
            self.insert_product,
            self.insert_order
        ]

        operation = random.choice(operations)
        try:
            operation()
            self.stats['inserts'] += 1
        except Exception as e:
            self.stats['errors'] += 1
            logger.error(f"Insert operation failed: {e}")

    def insert_user(self):
        """Insert a new user"""
        username = fake.user_name() + str(random.randint(10000, 99999))
        email = f"{username}@{fake.domain_name()}"
        full_name = fake.name()
        metadata = json.dumps({
            "signup_source": random.choice(["web", "mobile", "api"]),
            "timestamp": datetime.now().isoformat()
        })

        query = """
        INSERT INTO users (username, email, full_name, metadata)
        VALUES (%s, %s, %s, %s)
        """
        self.db.execute_query(query, (username, email, full_name, metadata), fetch=False)

    def insert_product(self):
        """Insert a new product"""
        name = fake.catch_phrase()
        description = fake.text(max_nb_chars=200)
        price = round(random.uniform(10.00, 999.99), 2)
        stock_quantity = random.randint(0, 1000)
        category = random.choice(["Electronics", "Clothing", "Books", "Home", "Sports"])

        query = """
        INSERT INTO products (name, description, price, stock_quantity, category)
        VALUES (%s, %s, %s, %s, %s)
        """
        self.db.execute_query(query, (name, description, price, stock_quantity, category), fetch=False)

    def insert_order(self):
        """Insert a new order with items"""
        user_id = self.get_random_user_id()
        if not user_id:
            return

        status = random.choice(["pending", "processing"])
        shipping_address = fake.address()

        # Insert order
        order_query = """
        INSERT INTO orders (user_id, status, shipping_address, total_amount)
        VALUES (%s, %s, %s, %s)
        RETURNING id
        """
        result = self.db.execute_query(order_query, (user_id, status, shipping_address, 0))
        order_id = result[0]['id']

        # Add items
        num_items = random.randint(1, 3)
        total = 0

        for _ in range(num_items):
            product_id = self.get_random_product_id()
            if product_id:
                quantity = random.randint(1, 3)
                unit_price = round(random.uniform(10.00, 999.99), 2)
                subtotal = round(quantity * unit_price, 2)
                total += subtotal

                item_query = """
                INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal)
                VALUES (%s, %s, %s, %s, %s)
                """
                self.db.execute_query(item_query, (order_id, product_id, quantity, unit_price, subtotal), fetch=False)

        # Update total
        self.db.execute_query("UPDATE orders SET total_amount = %s WHERE id = %s", (total, order_id), fetch=False)

    def update_operations(self):
        """Various update operations"""
        operations = [
            self.update_user,
            self.update_product,
            self.update_order_status
        ]

        operation = random.choice(operations)
        try:
            operation()
            self.stats['updates'] += 1
        except Exception as e:
            self.stats['errors'] += 1
            logger.error(f"Update operation failed: {e}")

    def update_user(self):
        """Update user information"""
        user_id = self.get_random_user_id()
        if not user_id:
            return

        query = """
        UPDATE users
        SET full_name = %s, updated_at = CURRENT_TIMESTAMP
        WHERE id = %s
        """
        self.db.execute_query(query, (fake.name(), user_id), fetch=False)

    def update_product(self):
        """Update product stock"""
        product_id = self.get_random_product_id()
        if not product_id:
            return

        # Simulate stock changes
        change = random.randint(-10, 50)
        query = """
        UPDATE products
        SET stock_quantity = GREATEST(stock_quantity + %s, 0),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = %s
        """
        self.db.execute_query(query, (change, product_id), fetch=False)

    def update_order_status(self):
        """Update order status"""
        order_id = self.get_random_order_id()
        if not order_id:
            return

        new_status = random.choice(["processing", "shipped", "delivered"])
        query = """
        UPDATE orders
        SET status = %s
        WHERE id = %s AND status != 'cancelled'
        """
        self.db.execute_query(query, (new_status, order_id), fetch=False)

    def delete_operations(self):
        """Various delete operations (less frequent)"""
        operations = [
            self.soft_delete_user,
            self.delete_old_audit_logs
        ]

        operation = random.choice(operations)
        try:
            operation()
            self.stats['deletes'] += 1
        except Exception as e:
            self.stats['errors'] += 1
            logger.error(f"Delete operation failed: {e}")

    def soft_delete_user(self):
        """Soft delete a user by deactivating"""
        query = """
        UPDATE users
        SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
        WHERE id IN (
            SELECT id FROM users
            WHERE is_active = TRUE
            ORDER BY RANDOM()
            LIMIT 1
        )
        """
        self.db.execute_query(query, fetch=False)

    def delete_old_audit_logs(self):
        """Delete old audit log entries"""
        query = """
        DELETE FROM audit_log
        WHERE changed_at < NOW() - INTERVAL '1 hour'
        """
        self.db.execute_query(query, fetch=False)

    def run_mixed_workload(self):
        """Run mixed workload with weighted operations"""
        operation_weights = [
            (self.insert_operations, 50),   # 50% inserts
            (self.update_operations, 40),   # 40% updates
            (self.delete_operations, 10)    # 10% deletes
        ]

        operations, weights = zip(*operation_weights)

        sleep_time = 1.0 / self.operations_per_second

        logger.info(f"Starting write load: {self.operations_per_second} ops/sec")

        while not self.stop_event.is_set():
            try:
                operation = random.choices(operations, weights=weights)[0]
                operation()
                time.sleep(sleep_time)
            except KeyboardInterrupt:
                break
            except Exception as e:
                logger.error(f"Workload error: {e}")
                time.sleep(1)

    def print_stats(self):
        """Print statistics periodically"""
        while not self.stop_event.is_set():
            time.sleep(10)
            total_ops = sum([self.stats['inserts'], self.stats['updates'], self.stats['deletes']])
            logger.info(
                f"Stats - Total: {total_ops}, "
                f"Inserts: {self.stats['inserts']}, "
                f"Updates: {self.stats['updates']}, "
                f"Deletes: {self.stats['deletes']}, "
                f"Errors: {self.stats['errors']}"
            )

    def run(self):
        """Run the load simulator"""
        try:
            # Setup signal handlers
            signal.signal(signal.SIGINT, lambda s, f: self.stop())
            signal.signal(signal.SIGTERM, lambda s, f: self.stop())

            # Start stats thread
            stats_thread = Thread(target=self.print_stats, daemon=True)
            stats_thread.start()

            # Run workload
            self.run_mixed_workload()

        except Exception as e:
            logger.error(f"Load simulator failed: {e}")
            raise
        finally:
            self.stop()
            self.db.close_pool()

    def stop(self):
        """Stop the simulator"""
        if not self.stop_event.is_set():
            logger.info("Stopping write load simulator...")
            self.stop_event.set()


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="PostgreSQL Write Load Simulator")
    parser.add_argument(
        "--ops-per-second",
        type=int,
        default=WRITE_OPERATIONS_PER_SECOND,
        help=f"Number of operations per second (default: {WRITE_OPERATIONS_PER_SECOND})"
    )

    args = parser.parse_args()

    simulator = WriteLoadSimulator(operations_per_second=args.ops_per_second)
    simulator.run()
