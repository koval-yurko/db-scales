"""
Seeds the primary database with initial test data
Creates realistic schema and populates with diverse data types
"""
import logging
import random
import json
from datetime import datetime
from faker import Faker
from db_config import PRIMARY_CONFIG
from db_connection import DatabaseConnection

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

fake = Faker()


class DatabaseSeeder:
    """Handles database schema creation and data seeding"""

    def __init__(self):
        self.db = DatabaseConnection(PRIMARY_CONFIG)

    def create_schema(self):
        """Create test tables with various data types"""
        logger.info("Creating database schema...")

        schema = """
        -- Users table
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            email VARCHAR(100) UNIQUE NOT NULL,
            full_name VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_active BOOLEAN DEFAULT TRUE,
            metadata JSONB
        );

        -- Products table
        CREATE TABLE IF NOT EXISTS products (
            id SERIAL PRIMARY KEY,
            name VARCHAR(200) NOT NULL,
            description TEXT,
            price NUMERIC(10, 2) NOT NULL,
            stock_quantity INTEGER DEFAULT 0,
            category VARCHAR(50),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- Orders table
        CREATE TABLE IF NOT EXISTS orders (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            total_amount NUMERIC(10, 2),
            status VARCHAR(20) DEFAULT 'pending',
            shipping_address TEXT
        );

        -- Order items table
        CREATE TABLE IF NOT EXISTS order_items (
            id SERIAL PRIMARY KEY,
            order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
            product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
            quantity INTEGER NOT NULL,
            unit_price NUMERIC(10, 2) NOT NULL,
            subtotal NUMERIC(10, 2) NOT NULL
        );

        -- Audit log table (for tracking changes)
        CREATE TABLE IF NOT EXISTS audit_log (
            id SERIAL PRIMARY KEY,
            table_name VARCHAR(50),
            record_id INTEGER,
            action VARCHAR(20),
            changed_data JSONB,
            changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- Create indexes for performance
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
        CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
        CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
        CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);
        CREATE INDEX IF NOT EXISTS idx_audit_log_table_name ON audit_log(table_name, changed_at);
        """

        self.db.execute_query(schema, fetch=False)
        logger.info("Schema created successfully")

    def seed_users(self, count: int = 1000):
        """Seed users table"""
        logger.info(f"Seeding {count} users...")

        query = """
        INSERT INTO users (username, email, full_name, metadata, is_active)
        VALUES (%s, %s, %s, %s, %s)
        """

        for i in range(count):
            username = fake.user_name() + str(i)
            email = f"{username}@{fake.domain_name()}"
            full_name = fake.name()
            metadata = json.dumps({
                "signup_source": random.choice(["web", "mobile", "api"]),
                "preferences": {
                    "newsletter": random.choice([True, False]),
                    "notifications": random.choice([True, False])
                }
            })
            is_active = random.choice([True, True, True, False])  # 75% active

            self.db.execute_query(
                query,
                (username, email, full_name, metadata, is_active),
                fetch=False
            )

            if (i + 1) % 100 == 0:
                logger.info(f"Seeded {i + 1}/{count} users")

        logger.info(f"Successfully seeded {count} users")

    def seed_products(self, count: int = 500):
        """Seed products table"""
        logger.info(f"Seeding {count} products...")

        query = """
        INSERT INTO products (name, description, price, stock_quantity, category)
        VALUES (%s, %s, %s, %s, %s)
        """

        categories = ["Electronics", "Clothing", "Books", "Home", "Sports", "Toys"]

        for i in range(count):
            name = fake.catch_phrase()
            description = fake.text(max_nb_chars=200)
            price = round(random.uniform(10.00, 999.99), 2)
            stock_quantity = random.randint(0, 1000)
            category = random.choice(categories)

            self.db.execute_query(
                query,
                (name, description, price, stock_quantity, category),
                fetch=False
            )

            if (i + 1) % 100 == 0:
                logger.info(f"Seeded {i + 1}/{count} products")

        logger.info(f"Successfully seeded {count} products")

    def seed_orders(self, count: int = 2000):
        """Seed orders and order_items tables"""
        logger.info(f"Seeding {count} orders...")

        # Get user and product IDs
        user_ids = [row['id'] for row in self.db.execute_query(
            "SELECT id FROM users WHERE is_active = TRUE"
        )]
        product_ids = [row['id'] for row in self.db.execute_query(
            "SELECT id FROM products"
        )]

        if not user_ids or not product_ids:
            logger.error("No users or products found. Seed users and products first.")
            return

        order_query = """
        INSERT INTO orders (user_id, order_date, total_amount, status, shipping_address)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING id
        """

        item_query = """
        INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal)
        VALUES (%s, %s, %s, %s, %s)
        """

        statuses = ["pending", "processing", "shipped", "delivered", "cancelled"]

        for i in range(count):
            user_id = random.choice(user_ids)
            order_date = fake.date_time_between(start_date="-1y", end_date="now")
            status = random.choice(statuses)
            shipping_address = fake.address()

            # Create order
            order_result = self.db.execute_query(
                order_query,
                (user_id, order_date, 0, status, shipping_address),
                fetch=True
            )
            order_id = order_result[0]['id']

            # Add 1-5 items to order
            num_items = random.randint(1, 5)
            total_amount = 0

            for _ in range(num_items):
                product_id = random.choice(product_ids)
                quantity = random.randint(1, 5)
                unit_price = round(random.uniform(10.00, 999.99), 2)
                subtotal = round(quantity * unit_price, 2)
                total_amount += subtotal

                self.db.execute_query(
                    item_query,
                    (order_id, product_id, quantity, unit_price, subtotal),
                    fetch=False
                )

            # Update order total
            self.db.execute_query(
                "UPDATE orders SET total_amount = %s WHERE id = %s",
                (total_amount, order_id),
                fetch=False
            )

            if (i + 1) % 100 == 0:
                logger.info(f"Seeded {i + 1}/{count} orders")

        logger.info(f"Successfully seeded {count} orders")

    def run(self):
        """Run complete seeding process"""
        try:
            logger.info("Starting database seeding process...")
            start_time = datetime.now()

            self.create_schema()
            self.seed_users(1000)
            self.seed_products(500)
            self.seed_orders(2000)

            end_time = datetime.now()
            duration = (end_time - start_time).total_seconds()

            logger.info(f"Database seeding completed in {duration:.2f} seconds")

            # Print statistics
            stats = self.db.execute_query("""
                SELECT
                    (SELECT COUNT(*) FROM users) as users,
                    (SELECT COUNT(*) FROM products) as products,
                    (SELECT COUNT(*) FROM orders) as orders,
                    (SELECT COUNT(*) FROM order_items) as order_items
            """)
            logger.info(f"Database statistics: {dict(stats[0])}")

        except Exception as e:
            logger.error(f"Seeding failed: {e}")
            raise
        finally:
            self.db.close_pool()


if __name__ == "__main__":
    seeder = DatabaseSeeder()
    seeder.run()
