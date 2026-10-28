
"use strict";

const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");
const crypto = require("crypto");

const app = express();

app.use(cors({
  origin: "https://dd-pixel22.github.io"
}));
app.use(express.json({ limit: "1mb" }));

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

const JWT_SECRET = process.env.JWT_SECRET;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, original] = stored.split(":");
  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(original, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createToken(user) {
  const payload = Buffer.from(JSON.stringify({
    id: user.user_id,
    email: user.email,
    role: user.role,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000
  })).toString("base64url");

  const signature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
}

function auth(requiredRole) {
  return (req, res, next) => {
    try {
      if (!JWT_SECRET) {
        return res.status(500).json({ error: "Server authentication is not configured." });
      }

      const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const [payload, signature] = token.split(".");

      if (!payload || !signature) throw new Error("Missing token");

      const expected = crypto
        .createHmac("sha256", JWT_SECRET)
        .update(payload)
        .digest("base64url");

      const a = Buffer.from(signature);
      const b = Buffer.from(expected);

      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        throw new Error("Invalid token");
      }

      const user = JSON.parse(Buffer.from(payload, "base64url").toString());

      if (user.exp < Date.now()) throw new Error("Expired token");
      if (requiredRole && user.role !== requiredRole) {
        return res.status(403).json({ error: "Administrator access required." });
      }

      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: "Please sign in again." });
    }
  };
}

async function addColumn(sql) {
  try {
    await db.query(sql);
  } catch (error) {
    if (
      error.code !== "ER_DUP_FIELDNAME" &&
      error.code !== "ER_DUP_KEYNAME"
    ) throw error;
  }
}

async function initDatabase() {
  // Keep the existing tables and add stable IDs for frontend products/suppliers.
  await addColumn(
    "ALTER TABLE products ADD COLUMN sku VARCHAR(30) NULL"
  );
  await addColumn(
    "ALTER TABLE suppliers ADD COLUMN supplier_code VARCHAR(30) NULL"
  );
  await addColumn(
    "ALTER TABLE suppliers ADD COLUMN city VARCHAR(100) NULL"
  );
  await addColumn(
    "ALTER TABLE suppliers ADD COLUMN category VARCHAR(100) NULL"
  );

  await addColumn(
    "CREATE UNIQUE INDEX uq_products_sku ON products(sku)"
  );
  await addColumn(
    "CREATE UNIQUE INDEX uq_suppliers_code ON suppliers(supplier_code)"
  );

  const categoryNames = [
    "Structural Materials",
    "Advanced Blocks",
    "Green Materials",
    "Smart Glass",
    "Energy Efficiency",
    "Premium Finishes"
  ];

  for (const name of categoryNames) {
    await db.query(
      "INSERT IGNORE INTO categories (category_name) VALUES (?)",
      [name]
    );
  }

  const suppliers = [
    ["SUP01", "Apex Structural Supply", "Apex Sales Team", "9000000101", "sales@apex.example", "Hyderabad", "Structural Materials"],
    ["SUP02", "BuildCore Blocks", "BuildCore Team", "9000000102", "orders@buildcore.example", "Bengaluru", "Advanced Blocks"],
    ["SUP03", "ClearView Architectural", "ClearView Team", "9000000103", "sales@clearview.example", "Chennai", "Smart Glass"],
    ["SUP04", "Earthwise Materials", "Earthwise Team", "9000000104", "hello@earthwise.example", "Pune", "Green Materials"],
    ["SUP05", "Forma Finishes", "Forma Team", "9000000105", "orders@forma.example", "Hyderabad", "Premium Finishes"]
  ];

  for (const s of suppliers) {
    await db.query(
      `INSERT INTO suppliers
       (supplier_code, supplier_name, contact_person, phone, email, city, category)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE supplier_name = VALUES(supplier_name)`,
      s
    );
  }

  const products = [
    ["BT101","Premium Structural Cement","Structural Materials",420,"bag",180,"SUP01","High-strength cement for foundations and structural work."],
    ["BT102","AAC Lightweight Blocks","Advanced Blocks",78,"block",620,"SUP02","Lightweight blocks with excellent thermal performance."],
    ["BT103","Architectural Smart Glass","Smart Glass",1250,"sq. ft.",46,"SUP03","Contemporary glass for facades and interiors."],
    ["BT104","Reinforced Steel Bars","Structural Materials",685,"bar",240,"SUP01","Reinforcement steel for structural construction."],
    ["BT105","Eco-Friendly Bamboo Panels","Green Materials",890,"panel",74,"SUP04","Renewable decorative panels."],
    ["BT106","Thermal Insulation Boards","Energy Efficiency",540,"board",95,"SUP04","Insulation boards for building efficiency."],
    ["BT107","Premium Porcelain Tiles","Premium Finishes",115,"sq. ft.",360,"SUP05","Refined tile finishes for modern spaces."],
    ["BT108","Ready-Mix Concrete","Structural Materials",5900,"m³",22,"SUP01","Ready-mix concrete for construction projects."],
    ["BT109","Reclaimed Timber Boards","Green Materials",760,"board",58,"SUP04","Reclaimed timber boards for sustainable design."],
    ["BT110","Low-Energy LED Fixtures","Energy Efficiency",650,"unit",120,"SUP05","Energy-conscious lighting fixtures."],
    ["BT111","Decorative Wall Panels","Premium Finishes",460,"panel",88,"SUP05","Modern wall panels for interior finishes."],
    ["BT112","High-Performance Window Glass","Smart Glass",980,"sq. ft.",9,"SUP03","High-performance glazing for contemporary buildings."]
  ];

  for (const p of products) {
    const [[category]] = await db.query(
      "SELECT category_id FROM categories WHERE category_name = ?",
      [p[2]]
    );
    const [[supplier]] = await db.query(
      "SELECT supplier_id FROM suppliers WHERE supplier_code = ?",
      [p[6]]
    );

    await db.query(
      `INSERT INTO products
       (sku, category_id, product_name, description, unit, price,
        stock_quantity, low_stock_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, 10)
       ON DUPLICATE KEY UPDATE sku = VALUES(sku)`,
      [p[0], category.category_id, p[1], p[7], p[4], p[3], p[5]]
    );
  }

  // Create the administrator using private Render environment variables.
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
    const [[existing]] = await db.query(
      "SELECT user_id FROM users WHERE email = ?",
      [email]
    );

    if (!existing) {
      await db.query(
        `INSERT INTO users (full_name, email, password_hash, role)
         VALUES (?, ?, ?, 'admin')`,
        ["BuildTrack Administrator", email, hashPassword(process.env.ADMIN_PASSWORD)]
      );
    }
  }

  console.log("BuildTrack database is ready.");
}

app.get("/", (req, res) => {
  res.json({ message: "BuildTrack backend is running!" });
});

app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    const [[result]] = await db.query("SELECT DATABASE() AS name");
    res.json({
      status: "connected",
      database: result.name,
      message: "MySQL is working"
    });
  } catch (error) {
    console.error("Health check:", error.message);
    res.status(500).json({ status: "error", message: "Database connection failed" });
  }
});

// Register a customer.
app.post("/api/auth/register", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (name.length < 2 || !email.includes("@") || password.length < 8) {
      return res.status(400).json({
        error: "Enter a valid name, email, and password of at least 8 characters."
      });
    }

    const [result] = await db.query(
      `INSERT INTO users (full_name, email, password_hash, role)
       VALUES (?, ?, ?, 'customer')`,
      [name, email, hashPassword(password)]
    );

    const user = { user_id: result.insertId, full_name: name, email, role: "customer" };
    res.status(201).json({
      token: createToken(user),
      user: { id: user.user_id, name, email, role: user.role }
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "This email is already registered." });
    }
    console.error("Registration:", error.message);
    res.status(500).json({ error: "Registration failed." });
  }
});

// Sign in as customer or administrator.
app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    const [[user]] = await db.query(
      "SELECT user_id, full_name, email, password_hash, role FROM users WHERE email = ?",
      [email]
    );

    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }

    res.json({
      token: createToken(user),
      user: {
        id: user.user_id,
        name: user.full_name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error("Login:", error.message);
    res.status(500).json({ error: "Login failed." });
  }
});

// Read products from MySQL.
app.get("/api/products", async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT p.product_id, p.sku, p.product_name, p.description, p.unit,
             p.price, p.stock_quantity, c.category_name, s.supplier_code
      FROM products p
      JOIN categories c ON c.category_id = p.category_id
      LEFT JOIN suppliers s ON s.supplier_id = (
        SELECT MIN(supplier_id) FROM suppliers
        WHERE category = c.category_name
      )
      ORDER BY p.product_id
    `);

    res.json(rows.map(p => ({
      id: p.sku || String(p.product_id),
      databaseId: p.product_id,
      name: p.product_name,
      description: p.description,
      category: p.category_name,
      price: Number(p.price),
      unit: p.unit,
      stock: p.stock_quantity,
      supplierId: p.supplier_code,
      active: true
    })));
  } catch (error) {
    console.error("Products:", error.message);
    res.status(500).json({ error: "Could not load products." });
  }
});

// Read supplier records from MySQL.
app.get("/api/suppliers", async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT supplier_code, supplier_name, contact_person, phone, email,
              city, category, address
       FROM suppliers ORDER BY supplier_name`
    );

    res.json(rows.map(s => ({
      id: s.supplier_code || String(s.supplier_name),
      name: s.supplier_name,
      contact: s.contact_person,
      phone: s.phone,
      email: s.email,
      city: s.city || s.address || "",
      category: s.category || ""
    })));
  } catch (error) {
    console.error("Suppliers:", error.message);
    res.status(500).json({ error: "Could not load suppliers." });
  }
});

// Place an order using the signed-in customer's account.
app.post("/api/orders", auth("customer"), async (req, res) => {
  const items = req.body.items;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Your cart is empty." });
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const [orderResult] = await connection.query(
      "INSERT INTO purchase_orders (customer_id, status) VALUES (?, 'pending')",
      [req.user.id]
    );

    const orderId = orderResult.insertId;

    for (const item of items) {
      const sku = String(item.id || item.sku || "");
      const quantity = Number(item.qty || item.quantity);

      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new Error("Invalid item quantity.");
      }

      const [[product]] = await connection.query(
        "SELECT product_id, price, stock_quantity FROM products WHERE sku = ? FOR UPDATE",
        [sku]
      );

      if (!product) throw new Error(`Product ${sku} was not found.`);
      if (product.stock_quantity < quantity) {
        throw new Error(`Not enough stock for ${sku}.`);
      }

      await connection.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
         VALUES (?, ?, ?, ?)`,
        [orderId, product.product_id, quantity, product.price]
      );

      await connection.query(
        "UPDATE products SET stock_quantity = stock_quantity - ? WHERE product_id = ?",
        [quantity, product.product_id]
      );

      await connection.query(
        `INSERT INTO stock_movements (product_id, quantity_change, reason)
         VALUES (?, ?, ?)`,
        [product.product_id, -quantity, `Order ${orderId}`]
      );
    }

    await connection.commit();

    res.status(201).json({
      id: `BT-${orderId}`,
      databaseId: orderId,
      status: "Pending",
      message: "Order saved successfully."
    });
  } catch (error) {
    await connection.rollback();
    console.error("Order creation:", error.message);
    res.status(400).json({ error: error.message || "Could not place order." });
  } finally {
    connection.release();
  }
});

// Read the signed-in customer's orders, or all orders for an administrator.
app.get("/api/orders", auth(), async (req, res) => {
  try {
    const isAdmin = req.user.role === "admin";
    const [orders] = await db.query(
      `SELECT po.order_id, po.customer_id, u.full_name, u.email,
              po.order_date, po.status,
              COALESCE(SUM(oi.quantity * oi.unit_price), 0) AS total_amount
       FROM purchase_orders po
       JOIN users u ON u.user_id = po.customer_id
       LEFT JOIN order_items oi ON oi.order_id = po.order_id
       ${isAdmin ? "" : "WHERE po.customer_id = ?"}
       GROUP BY po.order_id, po.customer_id, u.full_name, u.email,
                po.order_date, po.status
       ORDER BY po.order_date DESC`,
      isAdmin ? [] : [req.user.id]
    );

    const output = [];

    for (const order of orders) {
      const [items] = await db.query(
        `SELECT p.sku, p.product_name, oi.quantity, oi.unit_price
         FROM order_items oi JOIN products p ON p.product_id = oi.product_id
         WHERE oi.order_id = ?`,
        [order.order_id]
      );

      const statusMap = {
        pending: "Pending",
        confirmed: "Approved",
        completed: "Delivered",
        cancelled: "Cancelled"
      };

      output.push({
        id: `BT-${order.order_id}`,
        databaseId: order.order_id,
        customer: order.full_name,
        email: order.email,
        date: order.order_date,
        status: statusMap[order.status] || "Pending",
        total: Number(order.total_amount),
        items: items.map(i => ({
          id: i.sku,
          name: i.product_name,
          qty: i.quantity,
          price: Number(i.unit_price)
        }))
      });
    }

    res.json(output);
  } catch (error) {
    console.error("Read orders:", error.message);
    res.status(500).json({ error: "Could not load orders." });
  }
});

// Administrator updates order status.
app.patch("/api/orders/:id/status", auth("admin"), async (req, res) => {
  const statusMap = {
    Pending: "pending",
    Approved: "confirmed",
    Processing: "confirmed",
    Delivered: "completed",
    Cancelled: "cancelled"
  };

  const status = statusMap[req.body.status] || statusMap[String(req.body.status)];
  const id = Number(String(req.params.id).replace(/^BT-/, ""));

  if (!Number.isInteger(id) || id < 1 || !status) {
    return res.status(400).json({ error: "Invalid order ID or status." });
  }

  try {
    const [result] = await db.query(
      "UPDATE purchase_orders SET status = ? WHERE order_id = ?",
      [status, id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: "Order not found." });
    }

    res.json({ message: "Order status updated.", status });
  } catch (error) {
    console.error("Update status:", error.message);
    res.status(500).json({ error: "Could not update order status." });
  }
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    if (!JWT_SECRET || JWT_SECRET.length < 32) {
      throw new Error("Set JWT_SECRET in the Render environment variables (at least 32 characters).");
    }

    await initDatabase();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`BuildTrack API listening on port ${PORT}`);
    });
  } catch (error) {
    console.error("BuildTrack startup failed:", error.message);
    process.exit(1);
  }
}

startServer();
