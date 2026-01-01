-- Create tables and insert sample data
-- This script sets up the database schema (no replication configuration)

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Products table
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    stock INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

-- Orders table
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
    quantity INTEGER NOT NULL,
    total_price DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_product_id ON orders(product_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- Insert sample users
INSERT INTO users (username, email) VALUES
    ('alice', 'alice@example.com'),
    ('bob', 'bob@example.com'),
    ('charlie', 'charlie@example.com'),
    ('diana', 'diana@example.com'),
    ('eve', 'eve@example.com'),
    ('frank', 'frank@example.com'),
    ('grace', 'grace@example.com'),
    ('henry', 'henry@example.com'),
    ('iris', 'iris@example.com'),
    ('jack', 'jack@example.com')
ON CONFLICT (username) DO NOTHING;

-- Insert sample products
INSERT INTO products (name, price, stock) VALUES
    ('Laptop', 999.99, 50),
    ('Mouse', 29.99, 200),
    ('Keyboard', 79.99, 150),
    ('Monitor', 299.99, 75),
    ('Headphones', 149.99, 100),
    ('Webcam', 89.99, 80),
    ('USB Cable', 9.99, 500),
    ('Desk Lamp', 39.99, 120)
ON CONFLICT DO NOTHING;

-- Insert sample orders
INSERT INTO orders (user_id, product_id, quantity, total_price, status) VALUES
    (1, 1, 1, 999.99, 'completed'),
    (1, 2, 2, 59.98, 'completed'),
    (2, 3, 1, 79.99, 'completed'),
    (2, 4, 1, 299.99, 'pending'),
    (3, 5, 1, 149.99, 'completed'),
    (3, 6, 1, 89.99, 'shipped'),
    (4, 7, 5, 49.95, 'completed'),
    (4, 8, 1, 39.99, 'pending'),
    (5, 1, 1, 999.99, 'pending'),
    (5, 2, 3, 89.97, 'completed'),
    (6, 3, 1, 79.99, 'shipped'),
    (6, 5, 1, 149.99, 'completed'),
    (7, 4, 2, 599.98, 'pending'),
    (7, 6, 1, 89.99, 'completed'),
    (8, 7, 10, 99.90, 'completed'),
    (8, 8, 2, 79.98, 'shipped'),
    (9, 1, 1, 999.99, 'completed'),
    (9, 3, 1, 79.99, 'pending'),
    (10, 5, 2, 299.98, 'completed'),
    (10, 7, 20, 199.80, 'completed')
ON CONFLICT DO NOTHING;

-- Display summary
SELECT 'Tables created successfully!' AS message;
SELECT 'Users:' AS table_name, COUNT(*) AS row_count FROM users
UNION ALL
SELECT 'Products:', COUNT(*) FROM products
UNION ALL
SELECT 'Orders:', COUNT(*) FROM orders;
