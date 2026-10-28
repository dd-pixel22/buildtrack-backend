
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

// Test whether the backend is running
app.get("/", (req, res) => {
  res.json({ message: "BuildTrack backend is running!" });
});

// Test the MySQL connection
app.get("/api/health", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({
      status: "connected",
      database: "MySQL is working"
    });
  } catch (error) {
    console.error("Database connection failed:", error);
    res.status(500).json({
      status: "error",
      message: error.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`BuildTrack API listening on port ${PORT}`);
});
