// server.js

const express = require("express");
const cookieParser = require("cookie-parser");
const { v4: uuidv4 } = require("uuid");
const { Pool } = require("pg");
const path = require("path");
const bcrypt = require("bcrypt"); // For password hashing comparison
const jwt = require("jsonwebtoken"); // For generating authentication tokens
require("dotenv").config();
const nodemailer = require("nodemailer");
const Imap = require("imap-simple");
const { simpleParser } = require("mailparser");
// const fetch = require("node-fetch");
const axios = require("axios");
const { vpnCountryBlocker, retryHandler, employeeWhitelistPage, employeeWhitelistSubmit } = require("./vpn-blocker");

const app = express();
const port = process.env.PORT;
// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // needed for the /employee-whitelist form
app.use(cookieParser());

// PostgreSQL configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // Use connection string from the environment
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

const JWT_SECRET2 = process.env.JWT_SECRET;

// Middleware to assign session cookie
app.use((req, res, next) => {
  if (!req.cookies.sessionId) {
    const sessionId = uuidv4();
    res.cookie("sessionId", sessionId, {
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    req.cookies.sessionId = sessionId;
  }
  next();
});

// VPN + India geo-blocking (must be mounted BEFORE any routes so it
// actually protects them -- see vpn-blocker.js for how it works).
app.use(vpnCountryBlocker);

// DELETE endpoint to remove an item from the cart
app.delete("/remove-from-cart", async (req, res) => {
  const { id } = req.body;

  try {
    const result = await pool.query("DELETE FROM carts WHERE id = $1", [id]);
    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }
    res.json({ success: true, message: "Product removed successfully" });
  } catch (err) {
    console.error("Error removing product from cart:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// POST: Add item to cart
app.post("/add-to-cart", async (req, res) => {
  const sessionId = req.cookies.sessionId;
  const { productId, categoryId, name, quantity, mg, price, image_url } =
    req.body;
  console.log(name);
  if (!productId) {
    return res
      .status(400)
      .json({ success: false, message: "Product ID is required" });
  }
  console.log(req.body);

  try {
    await pool.query(
      "INSERT INTO carts (session_id, product_id, name, quantity, mg, price, image_url,category_id) VALUES ($1, $2, $3, $4, $5, $6, $7,$8)",
      [
        sessionId,
        productId,
        name || null,
        quantity || "1",
        mg || null,
        price || null,
        image_url || null,
        categoryId,
      ]
    );
    res.json({ success: true, message: "Product added to cart" });
  } catch (error) {
    console.error("Error inserting cart data:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/api/cart/count", async (req, res) => {
  try {
    const userId = req.cookies.sessionId; // Assume the user ID is available in the request
    const result = await pool.query(
      "SELECT COUNT(*) AS count FROM carts WHERE session_id = $1",
      [userId]
    );
    const count = result.rows[0].count;

    res.json({ success: true, count });
  } catch (err) {
    console.error("Error fetching cart count:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// GET: Fetch cart items
app.get("/api/cart", async (req, res) => {
  const sessionId = req.cookies.sessionId;
  if (!sessionId) {
    return res
      .status(400)
      .json({ success: false, message: "Session not found" });
  }
  try {
    const result = await pool.query(
      "SELECT * FROM carts WHERE session_id = $1",
      [sessionId]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    console.error("Error fetching cart data:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ========================================
// UPDATED /api/checkout endpoint
// ========================================

app.post("/api/checkout", async (req, res) => {
  const {
    firstName,
    lastName,
    phone,
    email,
    companyName,
    country,
    billingStreetAddress,
    apartment,
    billingCity,
    billingState,
    billingZip,
    cartItems,
    shippingCost,
    totalCost,
  } = req.body;

  console.log("Checkout data received:", req.body);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) Insert or update customer in customers table (master record)
    // This updates to keep latest contact info
    const userRes = await client.query(
      `INSERT INTO customers (
        first_name, last_name, email, phone, company_name, country,
        street_address, apartment, city, state, zip_code
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (email) 
      DO UPDATE SET 
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        phone = EXCLUDED.phone,
        company_name = EXCLUDED.company_name,
        country = EXCLUDED.country,
        street_address = EXCLUDED.street_address,
        apartment = EXCLUDED.apartment,
        city = EXCLUDED.city,
        state = EXCLUDED.state,
        zip_code = EXCLUDED.zip_code
      RETURNING id`,
      [
        firstName,
        lastName,
        email,
        phone,
        companyName || null,
        country,
        billingStreetAddress,
        apartment || null,
        billingCity,
        billingState,
        billingZip,
      ]
    );
    const userId = userRes.rows[0].id;

    // This preserves the customer data as it was at order time
    const SOURCE = process.env.SOURCE || "newlandss"; // set per server

    // 2) ✅ Insert order WITH customer snapshot
    // This preserves the customer data as it was at order time
    const orderRes = await client.query(
      `INSERT INTO orders (
        user_id, 
        total_amount, 
        shipping,
        customer_first_name,
        customer_last_name,
        customer_email,
        customer_phone,
        customer_company,
        customer_country,
        customer_street_address,
        customer_apartment,
        customer_city,
        customer_state,
        customer_zip_code
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING order_id`,
      [
        userId,
        totalCost,
        shippingCost,
        firstName,
        lastName,
        email,
        phone,
        companyName || null,
        country,
        billingStreetAddress,
        apartment || null,
        billingCity,
        billingState,
        billingZip
      ]
    );
    const orderId = orderRes.rows[0].order_id;

    // 3) Insert order items
    const insertItemText = `
      INSERT INTO order_items
        (order_id, product_id, name, mg, quantity, price)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;
    for (const item of cartItems) {
      await client.query(insertItemText, [
        orderId,
        item.product_id,
        item.name,
        item.mg,
        item.quantity,
        item.price,
      ]);
    }

    await client.query("COMMIT");

    // Send email
    try {
      const transporter = nodemailer.createTransport({
        host: "smtp.hostinger.com",
        port: 465,
        secure: true,
        auth: {
          user: "support@newlandsspharmacy.com",
          pass: "Newlandemail@123",
        },
      });
const currency = cartItems.currency;
      const shippingDisplay =
  Number(shippingCost || 0) === 0
    ? "Free Shipping"
    : `$${Number(shippingCost).toFixed(2)}`;

      const htmlBody = `
              <!DOCTYPE html>
              <html lang="en">
              <head>
                  <meta charset="UTF-8">
                  <title>Order Confirmation</title>
                  <style>
                      body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
                      .header { background-color: #f8f9fa; padding: 20px; text-align: center; border-radius: 5px; }
                      .content { padding: 20px; }
                      table { width: 100%; border-collapse: collapse; margin: 15px 0; }
                      th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                      th { background-color: #f2f2f2; }
                      .total { font-weight: bold; font-size: 16px; }
                      .footer { background-color: #f8f9fa; padding: 15px; margin-top: 20px; border-radius: 5px; }
                  </style>
              </head>
              <body>
                  <div class="header">
                      <h1>Order Confirmation - NewlandssPharmacy</h1>
                      <p>Thank you for your order, ${firstName} ${lastName}!</p>
                  </div>
                  <div class="content">
                      <p>Your order has been successfully placed and is being processed.</p>
                      <h2>Customer Information</h2>
                      <table>
                          <tr><td><strong>Name:</strong></td><td>${firstName} ${lastName}</td></tr>
                          <tr><td><strong>Phone:</strong></td><td>${phone}</td></tr>
                          <tr><td><strong>Email:</strong></td><td>${email}</td></tr>
                          <tr><td><strong>Address:</strong></td><td>${billingStreetAddress}, ${billingCity}, ${billingState}, ${billingZip}, ${country}</td></tr>
                          
                      </table>
                      <h2>Order Summary</h2>
                      <table>
                          <thead>
                              <tr>
                                  <th>Product Name</th>
                                  <th>Strength (mg)</th>
                                  <th>Quantity</th>
                                  <th>Price</th>
                              </tr>
                          </thead>
                          <tbody>
                              ${cartItems
                                .map(
                                  (item) => `
                                  <tr>
                                      <td>${item.name}</td>
                                      <td>${item.mg}</td>
                                      <td>${item.quantity}</td>
                                      <td>$${parseFloat(item.price).toFixed(
                                        2
                                      )}</td>
                                  </tr>
                              `
                                )
                                .join("")}
                          </tbody>
                      </table>
                      <div class="total">
                          <p>Shipping Cost: ${shippingDisplay}</p>
                          <p>Total Amount: $${parseFloat(totalCost).toFixed(
                            2
                          )}</p>
                      </div>
                  </div>
                  <div class="footer">
                      <h3>Contact Information</h3>
                      <p><strong>Phone:</strong> +1 (832) 689-7495</p>
                      <p><strong>What's App:</strong> +18324896759</p>
                      <p><strong>Email:</strong> support@newlandsspharmacy.com</p>
                      <p><em>This is an automated confirmation email.</em></p>
                      <p>© ${new Date().getFullYear()} NewlandssPharmacy. All rights reserved.</p>
                  </div>
              </body>
              </html>
        `;
      const mailOptions = {
        from: '"NewlandssPharmacy" <support@newlandsspharmacy.com>',
        to: email,
        subject: "Order Confirmation - NewlandssPharmacy",
        html: htmlBody,
      };

      await transporter.sendMail(mailOptions);
      // 5️⃣ SAVE EMAIL INTO “Sent” FOLDER using IMAP
      const rawEmail = `From: "NewlandssPharmacy" <support@newlandsspharmacy.com>
To: ${email}
Subject: Order Confermation
Content-Type: text/html; charset=UTF-8

${htmlBody}
`;

      const imapConfig = {
        imap: {
          user: "support@newlandsspharmacy.com",
          password: "Newlandemail@123",
          host: "imap.hostinger.com",
          port: 993,
          tls: true,
          authTimeout: 5000,
        },
      };

      const connection = await Imap.connect(imapConfig);
      // await connection.append(rawEmail, { mailbox: "INBOX.Sent" });

      await connection.append(rawEmail, {
        mailbox: "INBOX.Sent", // ✅ FIXED
      });

      res.json({
        success: true,
        message: "Order placed and email sent successfully!",
        orderId: orderId,
        userId: userId,
      });
    } catch (emailError) {
      console.error("Error sending email:", emailError);
      res.json({
        success: true,
        message: "Order placed successfully, but email notification failed.",
        orderId: orderId,
        userId: userId,
      });
    }
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Checkout error:", error);
    res.status(500).json({
      success: false,
      error: "Server error during checkout",
      details: error.message,
    });
  } finally {
    client.release();
  }
});

// ========================================
// NEW ENDPOINT: Get order with customer snapshot (with fallback)
// ========================================

app.get("/api/order-customer/:orderId", async (req, res) => {
  const { orderId } = req.params;

  try {
    // First, try to get customer data from order snapshot columns
    const orderResult = await pool.query(
      `SELECT 
        order_id,
        user_id,
        customer_first_name,
        customer_last_name,
        customer_email,
        customer_phone,
        customer_company,
        customer_country,
        customer_street_address,
        customer_apartment,
        customer_city,
        customer_state,
        customer_zip_code
      FROM orders 
      WHERE order_id = $1`,
      [orderId]
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = orderResult.rows[0];

    // ✅ Check if order has snapshot data (customer_first_name exists means snapshot exists)
    if (order.customer_first_name && order.customer_last_name) {
      // Order has snapshot data - use it
      console.log(`Order ${orderId}: Using snapshot data`);
      return res.json({
        order_id: order.order_id,
        user_id: order.user_id,
        first_name: order.customer_first_name,
        last_name: order.customer_last_name,
        email: order.customer_email,
        phone: order.customer_phone,
        company_name: order.customer_company,
        country: order.customer_country,
        street_address: order.customer_street_address,
        apartment: order.customer_apartment,
        city: order.customer_city,
        state: order.customer_state,
        zip_code: order.customer_zip_code,
        data_source: "snapshot", // For debugging
      });
    } else {
      // ✅ No snapshot data - fallback to customers table
      console.log(
        `Order ${orderId}: No snapshot found, using customers table (user_id: ${order.user_id})`
      );

      const customerResult = await pool.query(
        `SELECT * FROM customers WHERE id = $1`,
        [order.user_id]
      );

      if (customerResult.rows.length === 0) {
        return res.status(404).json({ error: "Customer not found" });
      }

      const customer = customerResult.rows[0];

      return res.json({
        order_id: order.order_id,
        user_id: order.user_id,
        first_name: customer.first_name,
        last_name: customer.last_name,
        email: customer.email,
        phone: customer.phone,
        company_name: customer.company_name,
        country: customer.country,
        street_address: customer.street_address,
        apartment: customer.apartment,
        city: customer.city,
        state: customer.state,
        zip_code: customer.zip_code,
        data_source: "customers_table", // For debugging
      });
    }
  } catch (err) {
    console.error("Error fetching order customer data:", err);
    res.status(500).json({ error: "Server error", details: err.message });
  }
});

// ========================================
// UPDATE YOUR MODAL FUNCTION IN employee.html
// ========================================

// ========================================
// UPDATED /api/manual-order endpoint
// ========================================

app.post("/api/manual-order", async (req, res) => {
  const {
    userId,
    firstName,
    lastName,
    email,
    phone,
    companyName,
    billingStreetAddress,
    apartment,
    billingCity,
    billingState,
    billingZip,
    country,
    shippingCost,
    totalCost,
    cartItems,
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let finalUserId = userId;

    // ✅ STEP 1: Check if email already exists in customers table
    const emailCheckResult = await client.query(
      `SELECT id FROM customers WHERE email = $1 LIMIT 1`,
      [email]
    );

    if (emailCheckResult.rows.length > 0) {
      // ✅ Email exists - use that customer ID and update their info
      finalUserId = emailCheckResult.rows[0].id;
      console.log(
        `✅ Found existing customer with email ${email}, ID: ${finalUserId}`
      );

      // Update existing customer info with latest data
      await client.query(
        `UPDATE customers SET 
          first_name=$1, last_name=$2, phone=$3, company_name=$4,
          street_address=$5, apartment=$6, city=$7, state=$8, zip_code=$9, country=$10
         WHERE id=$11`,
        [
          firstName,
          lastName,
          phone,
          companyName || null,
          billingStreetAddress,
          apartment || null,
          billingCity,
          billingState,
          billingZip,
          country,
          finalUserId,
        ]
      );
    } else {
      // ✅ Email doesn't exist - create new customer
      if (userId && !isNaN(userId)) {
        // User provided an ID but email doesn't match - still create new customer
        console.log(
          `⚠️ User ID ${userId} provided but email ${email} not found. Creating new customer.`
        );
      }

      const newCustomer = await client.query(
        `INSERT INTO customers 
         (first_name, last_name, email, phone, company_name, country,
          street_address, apartment, city, state, zip_code)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id`,
        [
          firstName,
          lastName,
          email,
          phone,
          companyName || null,
          country,
          billingStreetAddress,
          apartment || null,
          billingCity,
          billingState,
          billingZip,
        ]
      );
      finalUserId = newCustomer.rows[0].id;
      console.log(
        `✅ Created new customer with email ${email}, ID: ${finalUserId}`
      );
    }

    // ✅ STEP 2: Create the order with customer snapshot
    const orderRes = await client.query(
      `INSERT INTO orders (
        user_id, total_amount, shipping,
        customer_first_name, customer_last_name, customer_email, customer_phone,
        customer_company, customer_country, customer_street_address, 
        customer_apartment, customer_city, customer_state, customer_zip_code
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING order_id`,
      [
        finalUserId,
        totalCost,
        shippingCost,
        firstName,
        lastName,
        email,
        phone,
        companyName || null,
        country,
        billingStreetAddress,
        apartment || null,
        billingCity,
        billingState,
        billingZip,
      ]
    );

    const orderId = orderRes.rows[0].order_id;

    // ✅ STEP 3: Add all order items
    for (const item of cartItems) {
      await client.query(
        `INSERT INTO order_items (order_id, name, mg, quantity, price) 
         VALUES ($1,$2,$3,$4,$5)`,
        [orderId, item.name, item.mg, item.quantity, item.price]
      );
    }

    await client.query("COMMIT");

    // ✅ STEP 4: Send confirmation email
    try {
      const transporter = nodemailer.createTransport({
        host: "smtp.hostinger.com",
        port: 465,
        secure: true,
        auth: {
          user: "support@newlandsspharmacy.com",
          pass: "Newlandemail@123",
        },
      });

      const shippingDisplay =
  Number(shippingCost || 0) === 0
    ? "Free Shipping"
    : `$${Number(shippingCost).toFixed(2)}`;

      const htmlBody = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <title>Order Confirmation</title>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; }
                    .header { background-color: #f8f9fa; padding: 20px; text-align: center; border-radius: 5px; }
                    .content { padding: 20px; }
                    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
                    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                    th { background-color: #f2f2f2; }
                    .total { font-weight: bold; font-size: 16px; }
                    .footer { background-color: #f8f9fa; padding: 15px; margin-top: 20px; border-radius: 5px; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>Order Confirmation - NewlandssPharmacy</h1>
                    <p>Thank you for your order, ${firstName} ${lastName}!</p>
                </div>
                <div class="content">
                    <p>Your order has been successfully placed and is being processed.</p>
                    <h2>Customer Information</h2>
                    <table>
                        <tr><td><strong>Name:</strong></td><td>${firstName} ${lastName}</td></tr>
                        <tr><td><strong>Phone:</strong></td><td>${phone}</td></tr>
                        <tr><td><strong>Email:</strong></td><td>${email}</td></tr>
                        <tr><td><strong>Address:</strong></td><td>${billingStreetAddress}, ${billingCity}, ${billingState}, ${billingZip}, ${country}</td></tr>
                    </table>
                    <h2>Order Summary</h2>
                    <table>
                        <thead>
                            <tr>
                                <th>Product Name</th>
                                <th>Strength (mg)</th>
                                <th>Quantity</th>
                                <th>Price</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${cartItems
                              .map(
                                (item) => `
                                <tr>
                                    <td>${item.name}</td>
                                    <td>${item.mg}</td>
                                    <td>${item.quantity}</td>
                                    <td>$${parseFloat(item.price).toFixed(
                                      2
                                    )}</td>
                                </tr>
                            `
                              )
                              .join("")}
                        </tbody>
                    </table>
                    <div class="total">
                        <p>Shipping Cost: ${shippingDisplay}</p>
                        <p>Total Amount: $${parseFloat(totalCost).toFixed(
                          2
                        )}</p>
                    </div>
                </div>
                <div class="footer">
                    <h3>Contact Information</h3>
                    <p><strong>Phone:</strong> +1 (832) 689-7495</p>
                    <p><strong>What's App:</strong> +18324896759</p>
                    <p><strong>Email:</strong> support@newlandsspharmacy.com</p>
                    <p><em>This is an automated confirmation email.</em></p>
                    <p>© ${new Date().getFullYear()} NewlandssPharmacy. All rights reserved.</p>
                </div>
            </body>
            </html>
        `;
      const mailOptions = {
        from: '"NewlandssPharmacy" <support@newlandsspharmacy.com>',
        to: email,
        subject: "Order Confirmation - NewlandssPharmacy",
        html: htmlBody,
      };

      await transporter.sendMail(mailOptions);

      // 5️⃣ SAVE EMAIL INTO “Sent” FOLDER using IMAP
      const rawEmail = `From: "NewlandssPharmacy" <support@newlandsspharmacy.com>
To: ${email}
Subject: Order Confermation
Content-Type: text/html; charset=UTF-8

${htmlBody}
`;

      const imapConfig = {
        imap: {
          user: "support@newlandsspharmacy.com",
          password: "Newlandemail@123",
          host: "imap.hostinger.com",
          port: 993,
          tls: true,
          authTimeout: 5000,
        },
      };

      const connection = await Imap.connect(imapConfig);
      // await connection.append(rawEmail, { mailbox: "INBOX.Sent" });

      await connection.append(rawEmail, {
        mailbox: "INBOX.Sent", // ✅ FIXED
      });

      res.json({
        success: true,
        message:
          emailCheckResult.rows.length > 0
            ? "Order placed for existing customer! Email sent successfully!"
            : "New customer created and order placed! Email sent successfully!",
        orderId: orderId,
        userId: finalUserId,
        isNewCustomer: emailCheckResult.rows.length === 0,
      });
    } catch (emailError) {
      console.error("Error sending email:", emailError);
      res.json({
        success: true,
        message:
          emailCheckResult.rows.length > 0
            ? "Order placed for existing customer, but email notification failed."
            : "New customer created and order placed, but email notification failed.",
        orderId: orderId,
        userId: finalUserId,
        isNewCustomer: emailCheckResult.rows.length === 0,
      });
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Manual order error:", err);
    res.status(500).json({
      success: false,
      message: "Error creating manual order",
      error: err.message,
    });
  } finally {
    client.release();
  }
});

// ========================================
// 1️⃣ Get customer info + all orders by email
// ========================================
app.get("/api/customers/email/:email", async (req, res) => {
  const { email } = req.params;

  try {
    const customerResult = await pool.query(
      `SELECT * FROM customers WHERE email = $1`,
      [email]
    );

    if (customerResult.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Customer not found" });
    }

    const customer = customerResult.rows[0];

    const ordersResult = await pool.query(
      `SELECT order_id, total_amount, shipping, created_at, payment_status 
       FROM orders WHERE user_id = $1 ORDER BY created_at DESC`,
      [customer.id]
    );

    res.json({
      success: true,
      customer,
      orders: ordersResult.rows,
    });
  } catch (err) {
    console.error("Error fetching customer by email:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// ========================================
// 2️⃣ Get order items for a specific order
// ========================================
app.get("/api/order-items_email/:orderId", async (req, res) => {
  const { orderId } = req.params;

  try {
    const result = await pool.query(
      `SELECT name, mg, quantity, price FROM order_items WHERE order_id = $1`,
      [orderId]
    );

    res.json({ success: true, items: result.rows });
  } catch (err) {
    console.error("Error fetching order items:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Endpoint to get invoice data by order ID
app.get("/api/invoice/:orderId", async (req, res) => {
  const { orderId } = req.params;

  try {
    // Fetch order details
    const orderResult = await pool.query(
      `SELECT o.order_id, o.order_date, o.total, u.first_name, u.last_name, 
              u.email, u.phone, u.billing_address, u.billing_city, u.billing_state, 
              u.billing_zip, u.shipping_address, u.shipping_city, u.shipping_state, 
              u.shipping_zip 
       FROM orders o
       JOIN users u ON o.user_id = u.user_id
       WHERE o.order_id = $1`,
      [orderId]
    );

    const order = orderResult.rows[0];

    // Fetch order items
    const itemsResult = await pool.query(
      `SELECT product_name, price 
       FROM order_items 
       WHERE order_id = $1`,
      [orderId]
    );

    const items = itemsResult.rows;

    res.json({ order, items });
  } catch (err) {
    console.error("Error fetching invoice data:", err);
    res.status(500).json({ error: "Failed to fetch invoice data" });
  }
});

const JWT_SECRET = JWT_SECRET2;
app.get("/api/order-customer/:orderId", async (req, res) => {
  const { orderId } = req.params;

  try {
    const result = await pool.query(
      `SELECT 
        order_id,
        user_id,
        customer_first_name AS first_name,
        customer_last_name AS last_name,
        customer_email AS email,
        customer_phone AS phone,
        customer_company AS company_name,
        customer_country AS country,
        customer_street_address AS street_address,
        customer_apartment AS apartment,
        customer_city AS city,
        customer_state AS state,
        customer_zip_code AS zip_code
      FROM orders 
      WHERE order_id = $1`,
      [orderId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error fetching order customer data:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;

  // Input validation
  if (!username || !password) {
    return res
      .status(400)
      .json({ error: "Username and password are required" });
  }

  try {
    // Check if the user exists in the database
    const result = await pool.query(
      "SELECT * FROM employee_login WHERE username = $1",
      [username]
    );

    // Debug logging - log the actual rows data
    // console.log('Query result rows:', result.rows);
    // console.log('Number of rows found:', result.rows.length);

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const user = result.rows[0];
    // console.log('User found:', { id: user.id, username: user.username });
    // console.log('User Password ',user.password);
    // Compare the password with the hashed password in the database
    // const isPasswordValid = await bcrypt.compare(password, user.password);
    // console.log('Password validation result:', isPasswordValid);
    let isPasswordValid;
    if (password === user.password) {
      isPasswordValid = true;
    } else {
      isPasswordValid = false;
    }
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    // Create a JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    // Return the token to the client
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
      },
    });
  } catch (err) {
    console.error("Error during login:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/product?product_ID=5
app.get("/api/product", async (req, res) => {
  const { product_ID } = req.query;
  if (!product_ID) return res.status(400).json({ error: "product_ID missing" });

  try {
    // 1) fetch the main product row
    const prodRes = await pool.query(
      "SELECT * FROM products WHERE product_id = $1",
      [product_ID]
    );
    if (!prodRes.rows.length)
      return res.status(404).json({ error: "not found" });

    // 2) fetch its variants
    const varRes = await pool.query(
      "SELECT * FROM product_variants WHERE product_id = $1",
      [product_ID]
    );

    // 3) return both
    res.json({
      product: prodRes.rows[0],
      variants: varRes.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "server error" });
  }
});

// GET all variants for a product
app.get("/api/variants/:productId", async (req, res) => {
  const { productId } = req.params;
  const { rows } = await pool.query(
    `SELECT * FROM product_variants WHERE product_id = $1 ORDER BY variation_id`,
    [productId]
  );
  res.json(rows);
});

// PUT update one variant
app.put("/api/variants/:id", async (req, res) => {
  const { id } = req.params;
  const {
    unit_type,
    unit_value,
    qty,
    price_per_pill,
    price_per_box,
    offer_price,
    delivery_time,
  } = req.body;
  await pool.query(
    `UPDATE product_variants
     SET unit_type=$1, unit_value=$2, qty=$3, price_per_pill=$4, price_per_box=$5,
    offer_price=$6, delivery_time=$7
     WHERE variation_id=$8`,
    [
      unit_type,
      unit_value,
      qty,
      price_per_pill,
      price_per_box,
      offer_price || null,
      delivery_time,
      id,
    ]
  );
  res.json({ success: true });
});

// POST a brand‑new variant
app.post("/api/variants", async (req, res) => {
  const {
    product_id,
    unit_type,
    unit_value,
    qty,
    price_per_pill,
    price_per_box,
    offer_price ,
    delivery_time,
  } = req.body;
  const { rows } = await pool.query(
    `INSERT INTO product_variants
(product_id, unit_type, unit_value, qty, price_per_pill, price_per_box, offer_price, delivery_time)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      product_id,
      unit_type,
      unit_value,
      qty,
      price_per_pill,
      price_per_box,
      offer_price || null, 
      delivery_time,
    ]
  );
  res.json(rows[0]);
});

// DELETE a single variation by its variation_id
app.delete("/api/variants/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "DELETE FROM product_variants WHERE variation_id = $1",
      [id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Variation not found" });
    }
    res.json({ message: "Variation deleted" });
  } catch (err) {
    console.error("Error deleting variation:", err);
    res.status(500).json({ error: "Failed to delete variation" });
  }
});

// Update product endpoint
app.put("/api/products/update/:id", async (req, res) => {
  const { id } = req.params; // Product ID from URL
  const updates = req.body; // Updated fields from request body

  try {
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No fields to update." });
    }

    // Build dynamic SQL query
    const fields = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = fields
      .map((field, index) => `${field} = $${index + 1}`)
      .join(", ");

    const query = `UPDATE products SET ${setClause} WHERE product_id = $${
      fields.length + 1
    }`;
    values.push(id);

    // Execute query
    const result = await pool.query(query, values);

    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ error: "Product not found or no changes made." });
    }

    res.json({ message: "Product updated successfully." });
  } catch (err) {
    console.error("Error updating product:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.post("/api/products/search", async (req, res) => {
  const { id, name } = req.body;

  console.log(name);
  try {
    if (!id && !name) {
      return res
        .status(400)
        .json({ error: "Please provide either Product ID or Product Name." });
    }

    let query;
    let values;

    if (id) {
      query = "SELECT * FROM products WHERE product_id = $1  ";
      values = [id];
    } else {
      query = "SELECT * FROM products WHERE LOWER(product_name) = LOWER($1)";
      values = [name];
    }

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Product not found." });
    }

    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error("Error fetching product:", err);
    res.status(500).json({ error: "Failed to fetch product." });
  }
});

app.post("/api/set_products", async (req, res) => {
  const {
    category_id,
    product_name,
    product_description,
    trade_names,
    ingredients,
    manufactured_by,
    packaging_details,
    how_to_use,
    drug_interaction,
    side_effects,
    warnings_precautions,
    withdrawal_symptoms,
    drug_abuse,
    storage,
    primary_img,
    additional_img1,
    additional_img2,
    additional_img3,
    additional_img4,
    additional_img5,
    additional_img6,
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO products (
    category_id, product_name, product_description, trade_names, ingredients, manufacturer, packaging,
    usage_instructions, drug_interaction, side_effects,safety, withdrawal_symptoms, drug_abuse, storage,
    image_url, addtional_img1, addtional_img2, addtional_img3, addtional_img4, addtional_img5, addtional_img6
)VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
      )`,
      [
        category_id,
        product_name,
        product_description,
        trade_names,
        ingredients,
        manufactured_by,
        packaging_details,
        how_to_use,
        drug_interaction,
        side_effects,
        warnings_precautions,
        withdrawal_symptoms,
        drug_abuse,
        storage,
        primary_img,
        additional_img1,
        additional_img2,
        additional_img3,
        additional_img4,
        additional_img5,
        additional_img6,
      ]
    );

    res.json({
      success: true,
      message: "Product saved successfully!",
      product: result.rows[0],
    });
  } catch (err) {
    console.error("Error saving product:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete("/api/products/delete/:id", async (req, res) => {
  const { id } = req.params;
  // console.log("Received ID for deletion:", id); // Debug log

  if (isNaN(id)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid Product ID" });
  }

  try {
    const result = await pool.query(
      "DELETE FROM products WHERE product_id = $1",
      [id]
    );
    console.log("Query Result:", result); // Debug log

    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Product not found" });
    }

    res.json({ success: true, message: "Product deleted successfully" });
  } catch (err) {
    console.error("Error deleting product:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

// API to fetch products based on category
app.get("/products", async (req, res) => {
  const categoryID = req.query.categoryID || "all";
  // console.log("Received categoryID:", categoryID);

  try {
    let query;
    let params = [];
    if (categoryID === "all") {
      query = "SELECT * FROM products ORDER BY category_id";
    } else {
//       query =
//         `SELECT
//     p.*,
//     min_price.min_offer_price AS offer_price,
//     pr.average_rating AS rating
// FROM
//     products p
// JOIN
//     (
//         SELECT
//             product_id,
//             MIN(offer_price) AS min_offer_price
//         FROM
//             product_variants
//         GROUP BY
//             product_id
//     ) AS min_price
//     ON p.product_id = min_price.product_id
// LEFT JOIN -- Use LEFT JOIN to keep products even if they have no reviews
//     (
//         SELECT
//             product_id,
//             AVG(rating) AS average_rating -- Calculate the average rating
//         FROM
//             reviews
//         GROUP BY
//             product_id
//     ) AS pr
//     ON p.product_id = pr.product_id
// WHERE
//     p.category_id = $1
// ORDER BY
//     p.product_name;`;
//       params = [categoryID];
query = `SELECT 
    p.*, 
    pr.average_rating AS rating
  FROM products p
  LEFT JOIN (
    SELECT 
      product_id, 
      AVG(rating) AS average_rating
    FROM reviews
    GROUP BY product_id
  ) AS pr ON p.product_id = pr.product_id
  WHERE p.category_id = $1
  ORDER BY p.product_name`; 
params = [categoryID];
    }

    const result = await pool.query(query, params);
    // console.log("Result row",result.rows);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// API to fetch product prices
app.get("/product-prices", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM product_variants");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching product prices:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/requests", async (req, res) => {
  try {
    //  console.log("Fetching requests...");
    const result = await pool.query(`
      SELECT 
        *
      FROM orders 
      ORDER BY created_at DESC ;
    `);
    // console.log("Orders sample:", result.rows[0]);
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching requests:", err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/requests/:orderId
app.delete("/api/requests/:orderId", async (req, res) => {
  const { orderId } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) delete all items for that order
    await client.query("DELETE FROM order_items WHERE order_id = $1", [
      orderId,
    ]);

    // 2) delete the order itself
    await client.query("DELETE FROM orders WHERE order_id = $1", [orderId]);

    await client.query("COMMIT");
    res.json({ success: true, message: "Order and its items deleted." });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Error deleting request:", err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// Endpoint to fetch order items by order_id
app.get("/api/order-items/:order_id", async (req, res) => {
  const { order_id } = req.params;
  try {
    const result = await pool.query(
      "SELECT * FROM order_items WHERE order_id = $1",
      [order_id]
    ); // Adjust query for your schema
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Robust search endpoint: search by firstName and/or lastName
app.get("/api/customers/search", async (req, res) => {
  const firstNameRaw = (req.query.firstName || "").trim();
  const lastNameRaw = (req.query.lastName || "").trim();

  if (!firstNameRaw && !lastNameRaw) {
    return res
      .status(400)
      .json({
        success: false,
        message: "Provide firstName or lastName (or both)",
      });
  }

  try {
    // Build dynamic conditions & params for orders table
    const orderWhereClauses = [];
    const orderParams = [];

    if (firstNameRaw && lastNameRaw) {
      orderParams.push(`%${firstNameRaw} ${lastNameRaw}%`);
      orderWhereClauses.push(
        "(COALESCE(customer_first_name,'') || ' ' || COALESCE(customer_last_name,'')) ILIKE $" +
          orderParams.length
      );
    }
    if (firstNameRaw) {
      orderParams.push(`%${firstNameRaw}%`);
      orderWhereClauses.push(
        "(COALESCE(customer_first_name,'') ILIKE $" +
          orderParams.length +
          " OR COALESCE(customer_last_name,'') ILIKE $" +
          orderParams.length +
          ")"
      );
    }
    if (lastNameRaw) {
      orderParams.push(`%${lastNameRaw}%`);
      orderWhereClauses.push(
        "(COALESCE(customer_first_name,'') ILIKE $" +
          orderParams.length +
          " OR COALESCE(customer_last_name,'') ILIKE $" +
          orderParams.length +
          ")"
      );
    }

    const orderQuery = `
      SELECT DISTINCT
        COALESCE(customer_first_name, '') AS first_name,
        COALESCE(customer_last_name, '') AS last_name,
        user_id,
        customer_email AS email,
        customer_phone AS phone,
        order_id
      FROM orders
      WHERE ${orderWhereClauses.join(" OR ")}
      LIMIT 200
    `;

    const orderResult = await pool.query(orderQuery, orderParams);

    // Build dynamic conditions & params for customers table
    const custWhereClauses = [];
    const custParams = [];

    if (firstNameRaw && lastNameRaw) {
      custParams.push(`%${firstNameRaw} ${lastNameRaw}%`);
      custWhereClauses.push(
        "(COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')) ILIKE $" +
          custParams.length
      );
    }
    if (firstNameRaw) {
      custParams.push(`%${firstNameRaw}%`);
      custWhereClauses.push(
        "(COALESCE(first_name,'') ILIKE $" +
          custParams.length +
          " OR COALESCE(last_name,'') ILIKE $" +
          custParams.length +
          ")"
      );
    }
    if (lastNameRaw) {
      custParams.push(`%${lastNameRaw}%`);
      custWhereClauses.push(
        "(COALESCE(first_name,'') ILIKE $" +
          custParams.length +
          " OR COALESCE(last_name,'') ILIKE $" +
          custParams.length +
          ")"
      );
    }

    const custQuery = `
      SELECT
        COALESCE(first_name, '') AS first_name,
        COALESCE(last_name, '') AS last_name,
        id AS user_id,
        email,
        phone
      FROM customers
      WHERE ${custWhereClauses.join(" OR ")}
      LIMIT 200
    `;
    const custResult = await pool.query(custQuery, custParams);

    // Combine results and deduplicate by "name-id"
    const combined = [...orderResult.rows, ...custResult.rows];
    const seen = new Set();
    const unique = [];

    combined.forEach((r) => {
      const fname = (r.first_name || "").trim();
      const lname = (r.last_name || "").trim();
      const id =
        r.user_id === null || r.user_id === undefined ? "" : String(r.user_id);
      const orderId = r.order_id;
      const key = `${fname} ${lname}-${id}`.trim();

      if (!seen.has(key)) {
        seen.add(key);
        unique.push({
          first_name: fname,
          last_name: lname,
          user_id: id,
          email: r.email || null,
          phone: r.phone || null,
          order_id: orderId || null,
          source:
            r.user_id && r.email
              ? "orders/customers"
              : r.email
              ? "customers"
              : "orders", // advisory
        });
      }
    });

    return res.json({ success: true, count: unique.length, data: unique });
  } catch (err) {
    console.error("Error in /api/customers/search:", err.stack || err);
    return res
      .status(500)
      .json({ success: false, message: "Server error", details: err.message });
  }
});

// GET customer by ID
app.get("/api/customers/:id", async (req, res) => {
  const { id } = req.params;
  console.log(id);
  try {
    const result = await pool.query("SELECT * FROM customers WHERE id = $1", [
      id,
    ]);
    if (!result.rows.length) {
      return res.status(404).json({ error: "Customer not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// Add this endpoint to your server.js file (before the "Start server" section)

// GET: Customer Order Tracking - Complete customer data with all orders
app.get("/api/customer-tracking/:userId", async (req, res) => {
  const { userId } = req.params;

  try {
    // 1) Fetch customer details
    const customerResult = await pool.query(
      "SELECT * FROM customers WHERE id = $1",
      [userId]
    );

    if (customerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const customer = customerResult.rows[0];

    // 2) Fetch all orders for this customer with timestamps
    const ordersResult = await pool.query(
      `SELECT *
       FROM orders 
       WHERE user_id = $1 
       ORDER BY created_at DESC`,
      [userId]
    );

    const orders = ordersResult.rows;

    // 3) For each order, fetch its items
    const ordersWithItems = await Promise.all(
      orders.map(async (order) => {
        const itemsResult = await pool.query(
          `SELECT *
           FROM order_items 
           WHERE order_id = $1`,
          [order.order_id]
        );

        return {
          ...order,
          items: itemsResult.rows,
          itemCount: itemsResult.rows.length,
        };
      })
    );

    // 4) Calculate total lifetime value
    const totalSpent = orders.reduce(
      (sum, order) => sum + parseFloat(order.total_amount || 0),
      0
    );

    // 5) Return complete data
    res.json({
      success: true,
      data: {
        customer,
        orders: ordersWithItems,
        totalOrders: orders.length,
        totalSpent: totalSpent.toFixed(2),
      },
    });
  } catch (error) {
    console.error("Error fetching customer tracking data:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// PUT: Update payment status for an order
app.put("/api/orders/:orderId/payment-status", async (req, res) => {
  const { orderId } = req.params;
  const { status } = req.body;

  const validStatuses = ["pending", "completed", "failed", "refunded"];
  if (!status || !validStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Invalid payment status",
    });
  }

  try {
    const query =
      status === "completed"
        ? `UPDATE orders 
         SET payment_status = $1, payment_date = CURRENT_TIMESTAMP 
         WHERE order_id = $2 
         RETURNING *`
        : `UPDATE orders 
         SET payment_status = $1 
         WHERE order_id = $2 
         RETURNING *`;

    const result = await pool.query(query, [status, orderId]);

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    res.json({
      success: true,
      message: `Payment status updated to '${status}'`,
      order: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating payment status:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

// GET: Get payment status for an order
app.get("/api/orders/:orderId/payment-status", async (req, res) => {
  const { orderId } = req.params;

  try {
    const result = await pool.query(
      `SELECT order_id, payment_status, payment_date, total_amount 
       FROM orders 
       WHERE order_id = $1`,
      [orderId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error fetching payment status:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

app.get("/api/orders/by-email/:email", async (req, res) => {
  const { email } = req.params;

  try {
    const customerResult = await pool.query(
      `SELECT * FROM customers WHERE email = $1`,
      [email]
    );

    if (customerResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }

    const customer = customerResult.rows[0];

    const ordersResult = await pool.query(
      `SELECT order_id, total_amount, shipping, created_at, payment_status
       FROM orders
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [customer.id]
    );

    const orders = await Promise.all(
      ordersResult.rows.map(async (order) => {
        const itemsResult = await pool.query(
          `SELECT name, mg, quantity, price
           FROM order_items
           WHERE order_id = $1`,
          [order.order_id]
        );

        return {
          ...order,
          items: itemsResult.rows,
        };
      })
    );

    return res.json({
      success: true,
      customer,
      orders,
    });
  } catch (err) {
    console.error("Error fetching orders by email:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
});

// app.post("/api/orders/:orderId/send-tracking", async (req, res) => {
//   const { orderId } = req.params;
//   const { trackingNumber, userId } = req.body;

//   try {

//    // Fetch customer email from Postgres
//     const result = await pool.query(
//       "SELECT email, first_name FROM customers WHERE id = $1",
//       [userId]
//     );

//     if (result.rows.length === 0) {
//       return res.status(404).json({ success: false, message: "Customer not found" });
//     }

//     const customer = result.rows[0];
//     const email = customer.email;
//     const name = customer.first_name;

//     // Email Setup for Zoho Mail
//     const transporter = nodemailer.createTransport({
//         host: "smtp.hostinger.com",
//         port: 465,
//         secure: true,
//         auth: {
//           user: "support@newlandsspharmacy.com",
//           pass: "Newlandemail@123",
//       },
//     });

//     //want to update
//     // Send email
//     await transporter.sendMail({
//       from: '"Mcland Pharma" <support@newlandsspharmacy.com>',
//       to: email,
//       subject: "Your Order has been Shipped",
//       text: `Hello ${name},\n\nYour order #${orderId} has been shipped.\nTracking Number: ${trackingNumber}\n\nThank you for shopping with us!`,
//     });

//     res.json({ success: true, message: "Tracking email sent successfully" });
//   } catch (err) {
//     console.error("Error sending tracking email:", err);
//     res.status(500).json({ success: false, message: "Error sending email" });
//   }
// });

app.post("/api/orders/:orderId/send-tracking", async (req, res) => {
  const { orderId } = req.params;
  const { trackingNumber, userId } = req.body;

  try {
    // 1️⃣ Fetch customer email
    const result = await pool.query(
      "SELECT email, first_name FROM customers WHERE id = $1",
      [userId]
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Customer not found" });
    }

    const { email, first_name: name } = result.rows[0];

    // 2️⃣ Create HTML email content
    const htmlBody = `
      <!DOCTYPE html>
<html lang="en" style="margin:0;padding:0;">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>Order Confirmation</title>
  </head>

  <body style="margin:0;padding:0;background-color:#f4f4f4;font-family:Arial, sans-serif;">
    <table width="100%" border="0" cellspacing="0" cellpadding="0" 
           style="background-color:#f4f4f4;padding:20px 0;">
      <tr>
        <td align="center">

          <!-- Main Card -->
          <table width="600" border="0" cellspacing="0" cellpadding="0" 
                 style="background:#ffffff;border-radius:8px;overflow:hidden;">

            <!-- Header -->
            <tr>
              <td align="center" 
                  style="background-color:#028c7e;padding:20px 0;color:#ffffff;font-size:24px;font-weight:bold;">
                Order Confirmation
              </td>
            </tr>

            <!-- Message Body -->
            <tr>
              <td style="padding:25px 30px;color:#333333;font-size:15px;line-height:22px;">
                <p style="margin:0 0 15px;">
                  Hi <strong>${name}</strong>,  
                </p>

                <p style="margin:0 0 15px;">
                  Thank you for placing an order with <strong>NewlandssPharmacy</strong>.  
                  Below are your order details:
                </p>

                <!-- Order Box -->
                <table width="100%" border="0" cellspacing="0" cellpadding="0"
                       style="margin-top:20px;background:#f8f8f8;border-radius:6px;padding:15px;">
                  <tr>
                    <td style="font-size:14px;color:#333;">
                      <strong>Order ID:</strong> ${orderId}<br>
                      <strong>Tracking ID :</strong> ${trackingNumber}
                    </td>
                  </tr>
                </table>

                <p style="margin:20px 0 10px;">
                  Our support team will contact you shortly for confirmation.
                </p>

                <p style="margin:0;">
                  Thank you!  
                  <br><strong>NewlandssPharmacy</strong>
                </p>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td align="center" 
                  style="background:#fafafa;padding:18px;color:#777;font-size:12px;line-height:18px;">
                This is an automated email. Please do not reply.<br>
                © 2025 NewlandssPharmacy. All rights reserved.
              </td>
            </tr>

          </table>

        </td>
      </tr>
    </table>
  </body>
</html>
    `;

    // 3️⃣ Nodemailer SMTP (Hostinger)
    const transporter = nodemailer.createTransport({
      host: "smtp.hostinger.com",
      port: 465,
      secure: true,
      auth: {
        user: "support@newlandsspharmacy.com",
        pass: "Newlandemail@123",
      },
    });

    // 4️⃣ Send Email
    await transporter.sendMail({
      from: '"NewlandssPharmacy" <support@newlandsspharmacy.com>',
      to: email,
      subject: "Your Order Has Been Shipped",
      html: htmlBody,
    });

    // 5️⃣ SAVE EMAIL INTO “Sent” FOLDER using IMAP
    const rawEmail = `From: "NewlandssPharmacy" <support@newlandsspharmacy.com>
To: ${email}
Subject: Your Order Has Been Shipped
Content-Type: text/html; charset=UTF-8

${htmlBody}
`;

    const imapConfig = {
      imap: {
        user: "support@newlandsspharmacy.com",
        password: "Newlandemail@123",
        host: "imap.hostinger.com",
        port: 993,
        tls: true,
        authTimeout: 5000,
      },
    };

    const connection = await Imap.connect(imapConfig);
    // await connection.append(rawEmail, { mailbox: "INBOX.Sent" });

    await connection.append(rawEmail, {
      mailbox: "INBOX.Sent", // ✅ FIXED
    });

    // 6️⃣ Response
    res.json({
      success: true,
      message: "Tracking email sent successfully and saved to Sent folder",
    });
    await connection.end();
  } catch (err) {
    console.error("Error sending tracking email:", err);
    res.status(500).json({
      success: false,
      message: "Error sending tracking email",
    });
  }
});

// PUT /api/orders/:orderId/status - Update order status
app.put("/api/orders/:orderId/status", async (req, res) => {
  const { orderId } = req.params;
  const { status, payment_status } = req.body;

  // Use either status or payment_status (for backward compatibility)
  const newStatus = status || payment_status;

  // Validate status
  const validStatuses = [
    "pending",
    "paid",
    "process",
    "tracking",
    "delivered",
    "completed",
  ];
  if (!validStatuses.includes(newStatus)) {
    return res.status(400).json({
      success: false,
      message: "Invalid status. Must be one of: " + validStatuses.join(", "),
    });
  }

  try {
    const result = await pool.query(
      `UPDATE orders 
       SET payment_status = $1
       WHERE order_id = $2
       RETURNING *`,
      [newStatus, orderId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Order not found",
      });
    }

    console.log(`✅ Order #${orderId} status updated to: ${newStatus}`);

    res.json({
      success: true,
      message: `Order status updated to ${newStatus}`,
      order: result.rows[0],
    });
  } catch (err) {
    console.error("Error updating order status:", err);
    res.status(500).json({
      success: false,
      message: "Failed to update order status",
      error: err.message,
    });
  }
});

// ===== CONTACT FORM: send visitor message to the website's own email =====
const contactRateLimit = new Map(); // ip -> [timestamps]

app.post("/api/contact-message", async (req, res) => {
  try {
    const { email, message, website } = req.body || {};

    // Honeypot: bots fill this hidden field. Pretend success, send nothing.
    if (website) return res.json({ success: true });

    const cleanEmail = String(email || "").trim();
    const cleanMessage = String(message || "").trim();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 254) {
      return res.status(400).json({ success: false, message: "Please enter a valid email address." });
    }
    if (cleanMessage.length < 5 || cleanMessage.length > 2000) {
      return res.status(400).json({ success: false, message: "Message must be between 5 and 2000 characters." });
    }

    // Simple rate limit: max 3 messages per IP per 10 minutes
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const recent = (contactRateLimit.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
    if (recent.length >= 3) {
      return res.status(429).json({ success: false, message: "Too many messages. Please try again later." });
    }
    recent.push(now);
    contactRateLimit.set(ip, recent);

    // Escape user input before putting it in the HTML email
    const esc = (s) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

    const transporter = nodemailer.createTransport({
      host: "smtp.hostinger.com",
      port: 465,
      secure: true,
      auth: {
        user: "support@newlandsspharmacy.com",
        pass: "Newlandemail@123",
      },
    });

    await transporter.sendMail({
      from: '"NewlandssPharmacy Website" <support@newlandsspharmacy.com>',
      to: "support@newlandsspharmacy.com", // your website email (receives the message)
      replyTo: cleanEmail, // hitting "Reply" answers the visitor directly
      subject: "New website message from " + cleanEmail.replace(/[\r\n]/g, ""),
      text: "From: " + cleanEmail + "\n\n" + cleanMessage,
      html:
        '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#333">' +
        "<h2>New website message</h2>" +
        "<p><strong>From:</strong> " + esc(cleanEmail) + "</p>" +
        '<p style="white-space:pre-wrap;background:#f6f8fc;padding:14px;border-radius:8px">' + esc(cleanMessage) + "</p>" +
        "</div>",
    });

    res.json({ success: true, message: "Message sent." });
  } catch (err) {
    console.error("Error sending contact message:", err);
    res.status(500).json({ success: false, message: "Could not send your message. Please try again later." });
  }
});

// ✅ POST: Add a review (with verified purchase check)
app.post("/api/reviews", async (req, res) => {
  const { product_id, name, email, rating, review_text } = req.body;

  if (!product_id || !name || !email || !rating || !review_text) {
    return res
      .status(400)
      .json({ success: false, message: "All fields required" });
  }

  try {
    // ✅ Check if email exists in both 'customers' and 'orders'
    const customerCheck = await pool.query(
      `SELECT id FROM customers WHERE email = $1`,
      [email]
    );
    const orderCheck = await pool.query(
      `SELECT order_id FROM orders WHERE customer_email = $1`,
      [email]
    );

    const isVerified =
      customerCheck.rows.length > 0 && orderCheck.rows.length > 0;

    // ✅ Insert the review (include verified field)
    await pool.query(
      `INSERT INTO reviews (product_id, name, email, rating, review_text, verified)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [product_id, name, email, rating, review_text, isVerified]
    );

    res.json({
      success: true,
      verified: isVerified,
      message: isVerified
        ? "Review added and verified as purchase!"
        : "Review added successfully (unverified).",
    });
  } catch (err) {
    console.error("Error inserting review:", err);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

app.get("/api/reviews/:productId", async (req, res) => {
  const { productId } = req.params;
  try {
    const result = await pool.query(
      `SELECT name, rating, review_text, verified, created_at
       FROM reviews
       WHERE product_id = $1
       ORDER BY created_at DESC`,
      [productId]
    );
    res.json({ success: true, reviews: result.rows });
  } catch (err) {
    console.error("Error fetching reviews:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch reviews" });
  }
});

app.get("/api/reviews", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT name, rating, review_text, verified
       FROM reviews
       WHERE rating > 3
       ORDER BY created_at DESC
       LIMIT 10`
    );
    res.json({ success: true, reviews: result.rows });
  } catch (err) {
    console.error("Error fetching reviews:", err);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch reviews" });
  }
});

// ============================
// DATABASE BACKUP ROUTES
// ============================
// Add these routes to your existing server.js file
// Required dependencies (add to top of server.js if not present):
// const archiver = require('archiver');
// const { format } = require('date-fns');

const archiver = require("archiver");

// Helper function to format date for filenames
function getBackupTimestamp() {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, "-").slice(0, -5);
}

// ============================
// ROUTE 1: Download ALL formats (SQL + JSON + CSV ZIP)
// ============================
app.get("/api/backup/full/:Prop", async (req, res) => {
  const timestamp = getBackupTimestamp();
  // console.log('Backup Prop:', req.params.Prop);
  const Prop = req.params.Prop;
  if (Prop !== process.env.BACKUP) {
    return res.status(403).json({
      success: false,
      error: "Unauthorized access",
    });
  } else {
    try {
      console.log("🔄 Starting full database backup...");

      // Set response headers for zip download
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=mcland_pharma_backup_${timestamp}.zip`
      );

      // Create zip archive
      const archive = archiver("zip", { zlib: { level: 9 } });

      // Handle archive errors
      archive.on("error", (err) => {
        console.error("❌ Archive error:", err);
        throw err;
      });

      // Pipe archive to response
      archive.pipe(res);

      // === 1. Generate SQL Dump ===
      const sqlDump = await generateSQLDump();
      archive.append(sqlDump, { name: `backup_${timestamp}.sql` });

      // === 2. Generate JSON Backup ===
      const jsonBackup = await generateJSONBackup();
      archive.append(JSON.stringify(jsonBackup, null, 2), {
        name: `backup_${timestamp}.json`,
      });

      // === 3. Generate CSV Files ===
      const csvData = await generateCSVBackup();
      Object.keys(csvData).forEach((tableName) => {
        archive.append(csvData[tableName], {
          name: `csv/${tableName}_${timestamp}.csv`,
        });
      });

      // Finalize the archive
      await archive.finalize();

      console.log("✅ Full backup completed successfully");
    } catch (error) {
      console.error("❌ Backup error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: "Backup failed",
          details: error.message,
        });
      }
    }
  }
});

// ============================
// ROUTE 2: Download SQL Only
// ============================
app.get("/api/backup/sql", async (req, res) => {
  const timestamp = getBackupTimestamp();

  try {
    console.log("🔄 Generating SQL backup...");

    const sqlDump = await generateSQLDump();

    res.setHeader("Content-Type", "application/sql");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=backup_${timestamp}.sql`
    );
    res.send(sqlDump);

    console.log("✅ SQL backup completed");
  } catch (error) {
    console.error("❌ SQL backup error:", error);
    res.status(500).json({
      success: false,
      error: "SQL backup failed",
      details: error.message,
    });
  }
});

// ============================
// ROUTE 3: Download JSON Only
// ============================
app.get("/api/backup/json", async (req, res) => {
  const timestamp = getBackupTimestamp();

  try {
    console.log("🔄 Generating JSON backup...");

    const jsonBackup = await generateJSONBackup();

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=backup_${timestamp}.json`
    );
    res.json(jsonBackup);

    console.log("✅ JSON backup completed");
  } catch (error) {
    console.error("❌ JSON backup error:", error);
    res.status(500).json({
      success: false,
      error: "JSON backup failed",
      details: error.message,
    });
  }
});

// ============================
// ROUTE 4: Download CSV ZIP Only
// ============================
app.get("/api/backup/csv", async (req, res) => {
  const timestamp = getBackupTimestamp();

  try {
    console.log("🔄 Generating CSV backup...");

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=csv_backup_${timestamp}.zip`
    );

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("error", (err) => {
      throw err;
    });
    archive.pipe(res);

    const csvData = await generateCSVBackup();
    Object.keys(csvData).forEach((tableName) => {
      archive.append(csvData[tableName], { name: `${tableName}.csv` });
    });

    await archive.finalize();

    console.log("✅ CSV backup completed");
  } catch (error) {
    console.error("❌ CSV backup error:", error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: "CSV backup failed",
        details: error.message,
      });
    }
  }
});

// ============================
// HELPER FUNCTIONS
// ============================

// Generate SQL dump
async function generateSQLDump() {
  const tables = [
    "customers",
    "orders",
    "order_items",
    "products",
    "product_variants",
    "carts",
    "reviews",
    "employee_login",
  ];

  let sqlDump = `-- ====================================================\n`;
  sqlDump += `-- NewlandssPharmacy Database Backup\n`;
  sqlDump += `-- Generated: ${new Date().toISOString()}\n`;
  sqlDump += `-- Compatible with: PostgreSQL, MySQL, SQLite, SQL Server\n`;
  sqlDump += `-- Total Tables: ${tables.length}\n`;
  sqlDump += `-- ====================================================\n\n`;

  sqlDump += `-- Disable foreign key checks for import\n`;
  sqlDump += `-- PostgreSQL: (no command needed)\n`;
  sqlDump += `-- MySQL: SET FOREIGN_KEY_CHECKS=0;\n`;
  sqlDump += `-- SQLite: PRAGMA foreign_keys = OFF;\n\n`;

  // Store all constraints to add at the end
  let allIndexes = [];
  let allForeignKeys = [];

  for (const table of tables) {
    try {
      sqlDump += `\n-- ============================\n`;
      sqlDump += `-- Table: ${table}\n`;
      sqlDump += `-- ============================\n\n`;

      // Drop table (compatible with all databases)
      sqlDump += `DROP TABLE IF EXISTS ${table};\n\n`;

      // Get table structure
      const structureResult = await pool.query(
        `
        SELECT 
          column_name,
          data_type,
          character_maximum_length,
          numeric_precision,
          numeric_scale,
          is_nullable,
          column_default,
          udt_name
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position;
      `,
        [table]
      );

      if (structureResult.rows.length === 0) {
        sqlDump += `-- Warning: No structure found for table ${table}\n\n`;
        continue;
      }

      // Get primary key info first
      const pkResult = await pool.query(
        `
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu 
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.table_name = $1 
          AND tc.constraint_type = 'PRIMARY KEY'
        ORDER BY kcu.ordinal_position;
      `,
        [table]
      );

      const primaryKeyColumns = pkResult.rows.map((r) => r.column_name);

      // Build CREATE TABLE statement with universal SQL types
      sqlDump += `CREATE TABLE ${table} (\n`;

      const columnDefs = structureResult.rows.map((col) => {
        let def = `  ${col.column_name} `;

        // Convert to universal SQL data types
        let dataType = col.data_type;
        let universalType = "";

        // Map PostgreSQL types to universal SQL types
        if (col.udt_name === "int4" || dataType === "integer") {
          universalType = "INTEGER";
        } else if (col.udt_name === "int8" || dataType === "bigint") {
          universalType = "BIGINT";
        } else if (
          col.udt_name === "varchar" ||
          dataType === "character varying"
        ) {
          if (col.character_maximum_length) {
            universalType = `VARCHAR(${col.character_maximum_length})`;
          } else {
            universalType = "TEXT";
          }
        } else if (col.udt_name === "text" || dataType === "text") {
          universalType = "TEXT";
        } else if (
          col.udt_name === "timestamp" ||
          col.udt_name === "timestamptz"
        ) {
          universalType = "TIMESTAMP";
        } else if (col.udt_name === "date") {
          universalType = "DATE";
        } else if (col.udt_name === "numeric" || dataType === "numeric") {
          if (col.numeric_precision && col.numeric_scale) {
            universalType = `DECIMAL(${col.numeric_precision},${col.numeric_scale})`;
          } else if (col.numeric_precision) {
            universalType = `DECIMAL(${col.numeric_precision})`;
          } else {
            universalType = "DECIMAL(10,2)";
          }
        } else if (col.udt_name === "bool" || dataType === "boolean") {
          universalType = "BOOLEAN";
        } else if (col.udt_name === "float4" || dataType === "real") {
          universalType = "REAL";
        } else if (
          col.udt_name === "float8" ||
          dataType === "double precision"
        ) {
          universalType = "DOUBLE PRECISION";
        } else {
          // Default fallback
          universalType = dataType.toUpperCase();
        }

        def += universalType;

        // Handle auto-increment / serial columns (primary keys)
        if (
          primaryKeyColumns.includes(col.column_name) &&
          col.column_default &&
          col.column_default.includes("nextval")
        ) {
          // AUTO_INCREMENT for MySQL, AUTOINCREMENT for SQLite, IDENTITY for SQL Server
          // PostgreSQL uses SERIAL
          def += " PRIMARY KEY"; // This makes it auto-increment in most databases
        }

        // NOT NULL constraint
        if (
          col.is_nullable === "NO" &&
          !primaryKeyColumns.includes(col.column_name)
        ) {
          def += " NOT NULL";
        }

        // Default value (skip for auto-increment columns)
        if (col.column_default && !col.column_default.includes("nextval")) {
          let defaultVal = col.column_default;

          // Clean up PostgreSQL-specific syntax
          defaultVal = defaultVal.replace(/::[\w\s]+/g, ""); // Remove type casts
          defaultVal = defaultVal.replace(/'/g, "'"); // Normalize quotes

          // Handle common defaults
          if (
            defaultVal.toUpperCase().includes("NOW()") ||
            defaultVal.toUpperCase().includes("CURRENT_TIMESTAMP")
          ) {
            def += " DEFAULT CURRENT_TIMESTAMP";
          } else if (
            defaultVal.toUpperCase() === "TRUE" ||
            defaultVal === "true"
          ) {
            def += " DEFAULT 1"; // Compatible with MySQL/SQLite
          } else if (
            defaultVal.toUpperCase() === "FALSE" ||
            defaultVal === "false"
          ) {
            def += " DEFAULT 0";
          } else if (!isNaN(defaultVal)) {
            def += ` DEFAULT ${defaultVal}`;
          } else if (defaultVal !== "") {
            def += ` DEFAULT ${defaultVal}`;
          }
        }

        return def;
      });

      sqlDump += columnDefs.join(",\n");

      // Add composite primary key if not already added
      if (primaryKeyColumns.length > 1) {
        sqlDump += `,\n  PRIMARY KEY (${primaryKeyColumns.join(", ")})`;
      }

      sqlDump += `\n);\n\n`;

      // Get all data from table
      const dataResult = await pool.query(`SELECT * FROM ${table}`);

      if (dataResult.rows.length > 0) {
        const columns = Object.keys(dataResult.rows[0]);

        sqlDump += `-- Data for ${table} (${dataResult.rows.length} rows)\n`;

        // Use standard INSERT statements (compatible with all databases)
        dataResult.rows.forEach((row) => {
          const values = columns.map((col) => {
            const val = row[col];

            if (val === null) {
              return "NULL";
            }

            if (typeof val === "boolean") {
              return val ? "1" : "0"; // Universal boolean (1/0)
            }

            if (typeof val === "number") {
              return val;
            }

            if (val instanceof Date) {
              return `'${val
                .toISOString()
                .replace("T", " ")
                .substring(0, 19)}'`;
            }

            if (typeof val === "string") {
              // Escape single quotes for all SQL databases
              const escaped = val.replace(/'/g, "''");
              return `'${escaped}'`;
            }

            if (typeof val === "object") {
              // Convert objects to JSON string
              const jsonStr = JSON.stringify(val).replace(/'/g, "''");
              return `'${jsonStr}'`;
            }

            return `'${val}'`;
          });

          sqlDump += `INSERT INTO ${table} (${columns.join(
            ", "
          )}) VALUES (${values.join(", ")});\n`;
        });

        sqlDump += `\n`;
      } else {
        sqlDump += `-- No data in ${table}\n\n`;
      }

      // Get indexes (store for later, excluding primary key)
      const indexResult = await pool.query(
        `
        SELECT 
          indexname,
          indexdef
        FROM pg_indexes
        WHERE tablename = $1
          AND indexname NOT LIKE '%_pkey'
          AND schemaname = 'public'
        ORDER BY indexname;
      `,
        [table]
      );

      if (indexResult.rows.length > 0) {
        indexResult.rows.forEach((idx) => {
          // Convert PostgreSQL index to universal SQL
          let indexDef = idx.indexdef;

          // Extract index name, table, and columns
          const match = indexDef.match(
            /CREATE (?:UNIQUE )?INDEX (\w+) ON \w+\.?(\w+) USING \w+ \(([^)]+)\)/i
          );
          if (match) {
            const isUnique = indexDef.includes("UNIQUE");
            const indexName = match[1];
            const columns = match[3];

            allIndexes.push({
              table: table,
              name: indexName,
              unique: isUnique,
              columns: columns,
              originalDef: indexDef,
            });
          }
        });
      }

      // Get foreign keys (store for later)
      const fkResult = await pool.query(
        `
        SELECT
          tc.constraint_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name,
          rc.update_rule,
          rc.delete_rule
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        JOIN information_schema.referential_constraints AS rc
          ON rc.constraint_name = tc.constraint_name
          AND rc.constraint_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = $1;
      `,
        [table]
      );

      if (fkResult.rows.length > 0) {
        fkResult.rows.forEach((fk) => {
          allForeignKeys.push({
            table: table,
            constraint_name: fk.constraint_name,
            column_name: fk.column_name,
            foreign_table: fk.foreign_table_name,
            foreign_column: fk.foreign_column_name,
            update_rule: fk.update_rule,
            delete_rule: fk.delete_rule,
          });
        });
      }
    } catch (err) {
      console.error(`Error backing up table ${table}:`, err);
      sqlDump += `-- Error backing up table ${table}: ${err.message}\n\n`;
    }
  }

  // Add all indexes at the end
  if (allIndexes.length > 0) {
    sqlDump += `\n-- ============================\n`;
    sqlDump += `-- Indexes (Universal SQL)\n`;
    sqlDump += `-- ============================\n\n`;

    allIndexes.forEach((idx) => {
      const uniqueStr = idx.unique ? "UNIQUE " : "";
      sqlDump += `-- Index: ${idx.name} on ${idx.table}\n`;
      sqlDump += `CREATE ${uniqueStr}INDEX ${idx.name} ON ${idx.table} (${idx.columns});\n\n`;
    });
  }

  // Add all foreign keys at the end
  if (allForeignKeys.length > 0) {
    sqlDump += `\n-- ============================\n`;
    sqlDump += `-- Foreign Key Constraints (Universal SQL)\n`;
    sqlDump += `-- ============================\n\n`;

    allForeignKeys.forEach((fk) => {
      sqlDump += `-- Foreign key: ${fk.constraint_name} on ${fk.table}\n`;
      sqlDump += `ALTER TABLE ${fk.table}\n`;
      sqlDump += `  ADD CONSTRAINT ${fk.constraint_name}\n`;
      sqlDump += `  FOREIGN KEY (${fk.column_name})\n`;
      sqlDump += `  REFERENCES ${fk.foreign_table}(${fk.foreign_column})`;

      // Add CASCADE rules if not default
      if (fk.delete_rule && fk.delete_rule !== "NO ACTION") {
        sqlDump += `\n  ON DELETE ${fk.delete_rule}`;
      }
      if (fk.update_rule && fk.update_rule !== "NO ACTION") {
        sqlDump += `\n  ON UPDATE ${fk.update_rule}`;
      }

      sqlDump += `;\n\n`;
    });
  }

  sqlDump += `\n-- ============================\n`;
  sqlDump += `-- Re-enable foreign key checks\n`;
  sqlDump += `-- ============================\n`;
  sqlDump += `-- MySQL: SET FOREIGN_KEY_CHECKS=1;\n`;
  sqlDump += `-- SQLite: PRAGMA foreign_keys = ON;\n\n`;

  sqlDump += `-- ============================\n`;
  sqlDump += `-- Backup completed successfully\n`;
  sqlDump += `-- Total tables: ${tables.length}\n`;
  sqlDump += `-- Total indexes: ${allIndexes.length}\n`;
  sqlDump += `-- Total foreign keys: ${allForeignKeys.length}\n`;
  sqlDump += `-- ============================\n`;

  return sqlDump;
}

// Generate JSON backup
async function generateJSONBackup() {
  const tables = [
    "customers",
    "orders",
    "order_items",
    "products",
    "product_variants",
    "carts",
    "reviews",
    "employee_login",
  ];

  const backup = {
    metadata: {
      timestamp: new Date().toISOString(),
      version: "1.0",
      database: "mcland_pharma",
    },
    tables: {},
  };

  for (const table of tables) {
    try {
      const result = await pool.query(`SELECT * FROM ${table}`);
      backup.tables[table] = {
        count: result.rows.length,
        data: result.rows,
      };
    } catch (err) {
      console.error(`Error backing up table ${table}:`, err);
      backup.tables[table] = {
        error: err.message,
      };
    }
  }

  return backup;
}

// Generate CSV backup
async function generateCSVBackup() {
  const tables = [
    "customers",
    "orders",
    "order_items",
    "products",
    "product_variants",
    "carts",
    "reviews",
    "employee_login",
  ];

  const csvFiles = {};

  for (const table of tables) {
    try {
      const result = await pool.query(`SELECT * FROM ${table}`);

      if (result.rows.length === 0) {
        csvFiles[table] = `No data in ${table} table\n`;
        continue;
      }

      // Get column headers
      const headers = Object.keys(result.rows[0]);
      let csv = headers.join(",") + "\n";

      // Add rows
      result.rows.forEach((row) => {
        const values = headers.map((header) => {
          const val = row[header];
          if (val === null) return "";
          if (typeof val === "string") {
            // Escape quotes and wrap in quotes if contains comma
            const escaped = val.replace(/"/g, '""');
            return val.includes(",") || val.includes("\n")
              ? `"${escaped}"`
              : escaped;
          }
          if (val instanceof Date) return val.toISOString();
          return val;
        });
        csv += values.join(",") + "\n";
      });

      csvFiles[table] = csv;
    } catch (err) {
      console.error(`Error backing up table ${table}:`, err);
      csvFiles[table] = `Error: ${err.message}\n`;
    }
  }

  return csvFiles;
}

// ============================
// ROUTE 5: Backup Status/Info
// ============================
app.get("/api/backup/info", async (req, res) => {
  try {
    const tables = [
      "customers",
      "orders",
      "order_items",
      "products",
      "product_variants",
      "carts",
      "reviews",
      "employee_login",
    ];

    const tableInfo = {};

    for (const table of tables) {
      const result = await pool.query(`SELECT COUNT(*) as count FROM ${table}`);
      tableInfo[table] = parseInt(result.rows[0].count);
    }

    res.json({
      success: true,
      database: "mcland_pharma",
      timestamp: new Date().toISOString(),
      tables: tableInfo,
      totalRecords: Object.values(tableInfo).reduce((a, b) => a + b, 0),
      availableFormats: ["full", "sql", "json", "csv"],
      routes: {
        full: "/api/backup/full",
        sql: "/api/backup/sql",
        json: "/api/backup/json",
        csv: "/api/backup/csv",
        info: "/api/backup/info",
      },
    });
  } catch (error) {
    console.error("Error getting backup info:", error);
    res.status(500).json({
      success: false,
      error: "Failed to get backup info",
      details: error.message,
    });
  }
});

// VPN + India geo-blocking retry route (lets a user re-check after
// turning their VPN off, etc.). Actual blocking logic lives in vpn-blocker.js
// and is mounted near the top of this file via app.use(vpnCountryBlocker).
app.get("/retry", retryHandler);
app.post("/retry", retryHandler);
app.get("/employee-whitelist", employeeWhitelistPage);
app.post("/employee-whitelist", employeeWhitelistSubmit);

app.use(express.static(path.join(__dirname, "public")));

// Page routes
app.get("/product_overview", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "product_overview.html"));
});

app.get("/cart", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "cart.html"));
});

app.get("/employee", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "employee.html"));
});

// Start server
const PORT = 9900;
app.listen(PORT,() => {
  console.log(`Server is running on port ${PORT}`);
});