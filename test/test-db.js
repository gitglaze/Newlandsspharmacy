require("dotenv").config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function testConnection() {
  try {
    const result = await pool.query("SELECT * FROM products WHERE product_id = 1");

    console.log("Connection successful:", result.rows[0]);
  } catch (err) {
    console.error("Connection error:", err);
  } finally {
    await pool.end();
  }
}

testConnection();
