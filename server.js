
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();

app.use(cors({
  origin: "https://dd-pixel22.github.io"
})); 
app.use(express.json());

const db = mysql.createPool({
  host: process.env.MYSQLHOST,
  port: Number(process.env.MYSQLPORT || 3306),
  user: process.env.MYSQLUSER,
  password: process.env.MYSQLPASSWORD,
  database: process.env.MYSQLDATABASE,
  ssl: { rejectUnauthorized: false },
  waitForConnections: true,
  connectionLimit: 5
});

async function initDatabase() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      user_id INT AUTO_INCREMENT PRIMARY KEY,
      full_name VARCHAR(100) NOT NULL,
      email VARCHAR(150) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('admin', 'customer') NOT NULL DEFAULT 'customer',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS categories (
      category_id INT AUTO_INCREMENT PRIMARY KEY,
      category_name VARCHAR(100) NOT NULL UNIQUE,
      description VARCHAR(255)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS suppliers (
      supplier_id INT AUTO_INCREMENT PRIMARY KEY,
      supplier_name VARCHAR(150) NOT NULL,
      contact_person VARCHAR(100),
      phone VARCHAR(30),
      email VARCHAR(150),
      address VARCHAR(255)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS products (
      product_id INT AUTO_INCREMENT PRIMARY KEY,
      category_id INT NOT NULL,
      product_name VARCHAR(150) NOT NULL,
      description TEXT,
      unit VARCHAR(30) NOT NULL DEFAULT 'piece',
      price DECIMAL(12,2) NOT NULL,
      stock_quantity INT NOT NULL DEFAULT 0,
      low_stock_level INT NOT NULL DEFAULT 10,
      FOREIGN KEY (category_id)
        REFERENCES categories(category_id),
      CHECK (price >= 0),
      CHECK (stock_quantity >= 0),
      CHECK (low_stock_level >= 0)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS purchase_orders (
      order_id INT AUTO_INCREMENT PRIMARY KEY,
      customer_id INT NOT NULL,
      supplier_id INT,
      order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      status ENUM(
        'pending', 'confirmed', 'completed', 'cancelled'
      ) NOT NULL DEFAULT 'pending',
      FOREIGN KEY (customer_id)
        REFERENCES users(user_id),
      FOREIGN KEY (supplier_id)
        REFERENCES suppliers(supplier_id)
        ON DELETE SET NULL
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS order_items (
      order_item_id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      product_id INT NOT NULL,
      quantity INT NOT NULL,
      unit_price DECIMAL(12,2) NOT NULL,
      FOREIGN KEY (order_id)
        REFERENCES purchase_orders(order_id)
        ON DELETE CASCADE,
      FOREIGN KEY (product_id)
        REFERENCES products(product_id),
      CHECK (quantity > 0),
      CHECK (unit_price >= 0)
    ) ENGINE=InnoDB`,

    `CREATE TABLE IF NOT EXISTS stock_movements (
      movement_id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      quantity_change INT NOT NULL,
      reason VARCHAR(100) NOT NULL,
      movement_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id)
        REFERENCES products(product_id)
    ) ENGINE=InnoDB`,

    `CREATE OR REPLACE VIEW order_totals AS
      SELECT
        po.order_id,
        po.customer_id,
        po.supplier_id,
        po.order_date,
        po.status,
        COALESCE(
          SUM(oi.quantity * oi.unit_price), 0
        ) AS total_amount
      FROM purchase_orders po
      LEFT JOIN order_items oi
        ON po.order_id = oi.order_id
      GROUP BY
        po.order_id,
        po.customer_id,
        po.supplier_id,
        po.order_date,
        po.status`,

    `CREATE OR REPLACE VIEW low_stock_products AS
      SELECT
        p.product_id,
        p.product_name,
        c.category_name,
        p.stock_quantity,
        p.low_stock_level
      FROM products p
      JOIN categories c
        ON p.category_id = c.category_id
      WHERE p.stock_quantity <= p.low_stock_level`
  ];

  for (const sql of statements) {
    await db.query(sql);
  }

  console.log("BuildTrack database tables and views are ready.");
}

// Test whether the backend is running
app.get("/", (req, res) => {
  res.json({
    message: "BuildTrack backend is running!"
  });
});

// Test the MySQL connection and table setup
app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    const [tables] = await db.query(`
      SELECT TABLE_NAME
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_TYPE = 'BASE TABLE'
      AND TABLE_NAME IN (
        'users', 'categories', 'suppliers',
        'products', 'purchase_orders',
        'order_items', 'stock_movements'
      )
    `);

    res.json({
      status: "connected",
      database: "MySQL is working",
      tablesCreated: tables.length,
      tables: tables.map(row => row.TABLE_NAME)
    });
  } catch (error) {
    console.error("Database health check failed:", error.message);
    res.status(500).json({
      status: "error",
      message: "Database health check failed"
    });
  }
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    await initDatabase();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`BuildTrack API listening on port ${PORT}`);
    });
  } catch (error) {
    console.error("Database setup failed:", error.message);
    process.exit(1);
  }
}

startServer();
