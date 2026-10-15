// test-all-get-routes.js
const app = require("./server");

const server = app.listen(0, async () => {
  const port = server.address().port;

  console.log("🔍 Running GET route tests...\n");

  // Helper to test a GET route
  async function testRoute(name, url) {
    try {
      const res = await fetch(`http://localhost:${port}${url}`);
      const contentType = res.headers.get("content-type") || "";

      console.log(`➡ GET ${url}`);

      console.log(`   Status: ${res.status}`);

      if (contentType.includes("application/json")) {
        const data = await res.json();
        console.log("   JSON ✔");
        console.log("   Keys:", Object.keys(data));
      } else {
        console.log("   Non-JSON ✔ (HTML or File)");
      }

      console.log("");
    } catch (err) {
      console.log(`   ❌ Error testing ${url}:`, err.message, "\n");
    }
  }

  // All testable GET routes
  const tests = [
    { name: "Requests", url: "/api/requests" },

    // Customers
    { name: "Customer Search", url: "/api/customers/search" },
    // { name: "Customer By ID", url: "/api/customers/1" },
    { name: "Customer Tracking", url: "/api/customer-tracking/1" },

    // Orders
    { name: "Order Items", url: "/api/order-items_email/1" },
    

    // Product related
    { name: "Product", url: "/api/product?product_ID=1" },
    { name: "Variants", url: "/api/variants/1" },

    // Reviews
    { name: "Reviews By Product", url: "/api/reviews/1" },
    { name: "Recent Reviews", url: "/api/reviews" },

    // Cart count
    { name: "Cart Count", url: "/api/cart/count" },

    // Backup (may show 403 if wrong secret — that's OK)
    { name: "Backup Info", url: "/api/backup/info" },

    // HTML Page routes
    { name: "Employee Page", url: "/employee" },
    { name: "Cart Page", url: "/cart" },
    { name: "Product Overview", url: "/product_overview" },
  ];

  // Run routes one by one
  for (const t of tests) {
    await testRoute(t.name, t.url);
  }

  server.close(() => console.log("🛑 Tests finished. Server closed."));
});
