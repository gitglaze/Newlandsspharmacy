// Check if employee is logged in
document.addEventListener("DOMContentLoaded", () => {
  const isLoggedIn = localStorage.getItem("employeeLoggedIn");
  if (isLoggedIn !== "true") {
    window.location.href = "employee-login.html";
    return;
  }
});

document.getElementById("logoutBtn").addEventListener("click", () => {
  localStorage.removeItem("employeeLoggedIn");
  localStorage.removeItem("employeeId");
  window.location.href = "employee-login.html";
});

// Load dashboard data
async function loadDashboardData() {
  try {
    const res = await fetch("/api/requests");
    const orders = await res.json();

    // Count unique clients
    const clients = new Set(orders.map((o) => o.user_id));

    // Categorize by payment status (supporting new statuses)
    let pending = 0,
      done = 0,
      processing = 0,
      tracking = 0,
      delivered = 0;
    paid = 0;

    orders.forEach((o) => {
      const status = o.payment_status || o.status || "pending";

      if (status === "pending") pending++;
      else if (status === "completed") done++;
      else if (status === "process") processing++;
      else if (status === "tracking") tracking++;
      else if (status === "delivered") delivered++;
      else if (status === "paid") paid++;
    });

    // Update dashboard
    document.getElementById("clientsHandled").textContent = clients.size;
    document.getElementById("paymentPending").textContent = pending;
    document.getElementById("paymentDone").textContent = done;
    document.getElementById("pendingRequests").textContent =
      processing + tracking + delivered + paid; // or adjust as needed
  } catch (err) {
    console.error("Error loading dashboard data:", err);
  }
}

// Load data when the page opens
document.addEventListener("DOMContentLoaded", loadDashboardData);

// Handle product addition form submission
document.addEventListener("DOMContentLoaded", () => {
  const productForm = document.getElementById("product-form");
  productForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const formData = new FormData(productForm);
      const formObject = Object.fromEntries(formData.entries());
      const response = await fetch(`/api/set_products`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formObject),
      });
      const result = await response.json();
      if (response.ok) {
        alert(result.message || "Product added successfully!");
        productForm.reset();
      } else {
        throw new Error(result.error || "Failed to add product.");
      }
    } catch (err) {
      console.error("Error submitting form:", err);
      alert("Error saving product. Check console for details.");
    }
  });
});

// Handle product search and edit
document.addEventListener("DOMContentLoaded", () => {
  const searchForm = document.getElementById("search-form");
  const resultDiv = document.getElementById("result");
  const editSection = document.getElementById("edit-section");
  const editForm = document.getElementById("edit-form");
  const editableFieldsDiv = document.getElementById("editable-fields");

  // Handle product search
  searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const productId = document.getElementById("product_id").value.trim();
    const productName = document.getElementById("product_name_2").value.trim();

    if (!productId && !productName) {
      alert("Please enter either a Product ID or Product Name.");
      return;
    }

    try {
      const response = await fetch(`/api/products/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: productId, name: productName }),
      });

      if (!response.ok) throw new Error("Failed to fetch product data.");

      const result = await response.json();
      const productData = result.data;

      document.getElementById("product-id").textContent =
        productData.product_id || "N/A";
      document.getElementById("category-id").textContent =
        productData.category_id || "N/A";
      document.getElementById("product-name").textContent =
        productData.product_name || "N/A";
      document.getElementById("product-description").textContent =
        productData.product_description || "N/A";
      document.getElementById("trade-names").textContent =
        productData.trade_names || "N/A";
      document.getElementById("ingreds").textContent =
        productData.ingredients || "N/A";
      document.getElementById("manufacturer").textContent =
        productData.manufacturer || "N/A";
      document.getElementById("packaging").textContent =
        productData.packaging || "N/A";
      document.getElementById("usage-instructions").textContent =
        productData.usage_instructions || "N/A";
      document.getElementById("drug-interaction").textContent =
        productData.drug_interaction || "N/A";
      document.getElementById("side-effects").textContent =
        productData.side_effects || "N/A";
      document.getElementById("safety").textContent =
        productData.safety || "N/A";
      document.getElementById("withdrawal-symptoms").textContent =
        productData.withdrawal_symptoms || "N/A";
      document.getElementById("drug-abuse").textContent =
        productData.drug_abuse || "N/A";
      document.getElementById("storage").textContent =
        productData.storage || "N/A";
      document.getElementById("image_url").textContent =
        productData.image_url || "N/A";
      document.getElementById("addtional-img1").textContent =
        productData.addtional_img1;
      document.getElementById("addtional-img2").textContent =
        productData.addtional_img2;
      document.getElementById("addtional-img3").textContent =
        productData.addtional_img3;
      document.getElementById("addtional-img4").textContent =
        productData.addtional_img4;
      document.getElementById("addtional-img5").textContent =
        productData.addtional_img5;
      document.getElementById("addtional-img6").textContent =
        productData.addtional_img6;
      document.getElementById("stocks").textContent = productData.stocks;

      resultDiv.style.display = "block";
    } catch (err) {
      console.error("Error fetching product:", err);
      alert("Error fetching product. Please try again.");
    }
  });

  // Handle product editing
  document.getElementById("edit-button").addEventListener("click", () => {
    editableFieldsDiv.innerHTML = "";
    const fields = [
      "category-id",
      "product-name",
      "product-description",
      "trade-names",
      "ingreds",
      "manufacturer",
      "packaging",
      "usage-instructions",
      "drug-interaction",
      "side-effects",
      "safety",
      "withdrawal-symptoms",
      "drug-abuse",
      "storage",
      "image_url",
      "addtional-img1",
      "addtional-img2",
      "addtional-img3",
      "addtional-img4",
      "addtional-img5",
      "addtional-img6",
      "stocks",
    ];

    fields.forEach((field) => {
      const label = document.createElement("label");
      label.textContent = field.replace("-", " ").toUpperCase();
      const input = document.createElement("input");
      input.type = "text";
      input.id = `edit-${field}`;
      const originalField = document.getElementById(field);
      input.value = originalField ? originalField.textContent : "";
      editableFieldsDiv.appendChild(label);
      editableFieldsDiv.appendChild(input);
    });

    editSection.style.display = "block";
  });

  // Handle edit form submission
  editForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const productId = document.getElementById("product-id").textContent;
    const updates = {};
    const fields = [
      "category-id",
      "product-name",
      "product-description",
      "trade-names",
      "ingreds",
      "manufacturer",
      "packaging",
      "usage-instructions",
      "drug-interaction",
      "side-effects",
      "safety",
      "withdrawal-symptoms",
      "drug-abuse",
      "storage",
      "image_url",
      "addtional-img1",
      "addtional-img2",
      "addtional-img3",
      "addtional-img4",
      "addtional-img5",
      "addtional-img6",
      "stocks",
    ];

    fields.forEach((field) => {
      const inputElement = document.getElementById(`edit-${field}`);
      if (inputElement) {
        const newValue = inputElement.value;
        const originalValue = document.getElementById(field)?.textContent || "";
        if (newValue !== originalValue) {
          updates[field.replace("-", "_")] = newValue;
        }
      }
    });

    try {
      const response = await fetch(`/api/products/update/${productId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });

      if (!response.ok) throw new Error("Failed to update product data.");
      alert("Product updated successfully!");
      resultDiv.style.display = "none";
      editSection.style.display = "none";
    } catch (err) {
      console.error("Error updating product:", err);
      alert("Error updating product. Please try again.");
    }
  });
});

// Handle product deletion
document.getElementById("delete-button").addEventListener("click", async () => {
  const productId = document.getElementById("product-id").textContent;
  if (!productId) {
    alert("No product ID found. Please search for a product first.");
    return;
  }
  if (
    !confirm(
      `Are you sure you want to delete the product with ID: ${productId}?`
    )
  )
    return;

  try {
    const response = await fetch(`/api/products/delete/${productId}`, {
      method: "DELETE",
    });
    const responseData = await response.json();
    if (!response.ok) throw new Error("Failed to delete product data.");
    alert("Product deleted successfully!");
    document.getElementById("result").style.display = "none";
  } catch (err) {
    console.error("Error deleting product:", err);
    alert("Error deleting product. Please try again.");
  }
});

// 🔍 Customer Order Tracking — Search by Name
document.addEventListener("DOMContentLoaded", () => {
  const searchBtn = document.getElementById("search-tracking-name");
  const firstInput = document.getElementById("tracking-first-name");
  const lastInput = document.getElementById("tracking-last-name");
  const resultsDiv = document.getElementById("tracking-name-results");
  const idInput = document.getElementById("tracking-user-id");
  const trackBtn = document.getElementById("btn-track-customer");
  const fetchBtn = document.getElementById("fetch-customer");
  const idInputManually = document.getElementById("manual-user-id");

  const clearResults = () => (resultsDiv.innerHTML = "");

  searchBtn.addEventListener("click", async () => {
    const firstName = firstInput.value.trim();
    const lastName = lastInput.value.trim();

    if (!firstName && !lastName) {
      resultsDiv.innerHTML = `<p style="color:red;">⚠️ Enter at least a first or last name.</p>`;
      return;
    }

    resultsDiv.innerHTML = `<p>🔎 Searching...</p>`;

    try {
      const query = new URLSearchParams({ firstName, lastName }).toString();
      const res = await fetch(`/api/customers/search?${query}`);
      const data = await res.json();

      if (!data.success) {
        resultsDiv.innerHTML = `<p style="color:red;">❌ ${
          data.message || "Server error"
        }</p>`;
        return;
      }

      if (data.data.length === 0) {
        resultsDiv.innerHTML = `<p>No customers found for "${firstName} ${lastName}".</p>`;
        return;
      }

      // Build results table
      const table = `
        <table style="width:100%;border-collapse:collapse;margin-top:1rem;">
          <thead>
            <tr style="background:#222;color:#fff;">
              <th style="padding:8px;border:1px solid #444;">#</th>
              <th style="padding:8px;border:1px solid #444;">Name</th>
              <th style="padding:8px;border:1px solid #444;">User ID</th>
              <th style="padding:8px;border:1px solid #444;">Email</th>
              <th style="padding:8px;border:1px solid #444;">Phone</th>
              <th style="padding:8px;border:1px solid #444;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${data.data
              .map(
                (c, i) => `
                <tr style="background:${
                  i % 2 === 0 ? "#f9f9f9" : "#fff"
                };text-align:center;">
                  <td style="padding:6px;border:1px solid #ccc;">${i + 1}</td>
                  <td style="padding:6px;border:1px solid #ccc;">${
                    c.first_name
                  } ${c.last_name}</td>
                  <td style="padding:6px;border:1px solid #ccc;">${
                    c.user_id
                  }</td>
                  <td style="padding:6px;border:1px solid #ccc;">${
                    c.email || "-"
                  }</td>
                  <td style="padding:6px;border:1px solid #ccc;">${
                    c.phone || "-"
                  }</td>
                  <td style="padding:6px;border:1px solid #ccc;">
                    <button class="select-track-customer"
                            data-id="${c.user_id}"
                            style="padding:4px 8px;background:#007bff;color:#fff;border:none;border-radius:4px;cursor:pointer;">
                      Customer
                    </button>
                    <button class="select-customer"
                            data-id="${c.user_id}"
                            style="padding:4px 8px;background:#007bff;color:#fff;border:none;border-radius:4px;cursor:pointer;">
                      Manual Order
                    </button>
                  </td>
                </tr>`
              )
              .join("")}
          </tbody>
        </table>
      `;

      resultsDiv.innerHTML = table;

      // When "Select" is clicked → fill ID + trigger existing tracking
      document.querySelectorAll(".select-track-customer").forEach((btn) => {
        btn.addEventListener("click", () => {
          const userId = btn.dataset.id;
          idInput.value = userId;
          clearResults();
          trackBtn.click(); // runs your /api/customer-tracking/:userId logic
        });
      });

      // Handle click on Select buttons
      document.querySelectorAll(".select-customer").forEach((btn) => {
        btn.addEventListener("click", () => {
          const userId = btn.dataset.id;
          idInputManually.value = userId;
          clearResults(); // Clear the search results after selection
          fetchBtn.click(); // Trigger your existing manual order logic
          document
            .querySelector("#manual-order-popup")
            .scrollIntoView({ behavior: "smooth" });
        });
      });
    } catch (err) {
      console.error("Error searching customers:", err);
      resultsDiv.innerHTML = `<p style="color:red;">⚠️ Unable to fetch results. Try again.</p>`;
    }
  });
});

// 🔍 Enhanced Search by Customer Name (with Email Display)
document.addEventListener("DOMContentLoaded", () => {
  const searchBtn = document.getElementById("search-customer-name");
  const firstInput = document.getElementById("manual-first-name");
  const lastInput = document.getElementById("manual-last-name");
  const resultsDiv = document.getElementById("name-search-results");
  const idInput = document.getElementById("manual-user-id");
  const fetchBtn = document.getElementById("fetch-customer");

  // Helper: Clear results area
  const clearResults = () => (resultsDiv.innerHTML = "");

  // Search customers
  searchBtn.addEventListener("click", async () => {
    const firstName = firstInput.value.trim();
    const lastName = lastInput.value.trim();

    if (!firstName && !lastName) {
      resultsDiv.innerHTML = `<p style="color:red;">⚠️ Please enter at least a first or last name.</p>`;
      return;
    }

    resultsDiv.innerHTML = `<p>🔍 Searching...</p>`;

    try {
      const res = await fetch(
        `/api/customers/search?firstName=${encodeURIComponent(
          firstName
        )}&lastName=${encodeURIComponent(lastName)}`
      );
      const data = await res.json();

      if (!data.success) {
        resultsDiv.innerHTML = `<p style="color:red;">❌ Server error: ${
          data.message || "Unknown issue"
        }</p>`;
        return;
      }

      if (data.data.length === 0) {
        resultsDiv.innerHTML = `<p>❕ No customers found for "${firstName} ${lastName}".</p>`;
        return;
      }

      // Build result table
      const tableHTML = `
        <table style="width:100%;border-collapse:collapse;margin-top:1rem;">
          <thead>
            <tr style="background:#222;color:#fff;">
              <th style="padding:8px;border:1px solid #444;">#</th>
              <th style="padding:8px;border:1px solid #444;">Name</th>
              <th style="padding:8px;border:1px solid #444;">User ID</th>
              <th style="padding:8px;border:1px solid #444;">Email</th>
              <th style="padding:8px;border:1px solid #444;">Phone</th>
              <th style="padding:8px;border:1px solid #444;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${data.data
              .map(
                (c, i) => `
                <tr style="text-align:center;background:${
                  i % 2 === 0 ? "#f9f9f9" : "#fff"
                };">
                  <td style="padding:6px;border:1px solid #ccc;">${i + 1}</td>
                  <td style="padding:6px;border:1px solid #ccc;">${
                    c.first_name
                  } ${c.last_name}</td>
                  <td style="padding:6px;border:1px solid #ccc;">${
                    c.user_id
                  }</td>
                  <td style="padding:6px;border:1px solid #ccc;">${
                    c.email || "-"
                  }</td>
                  <td style="padding:6px;border:1px solid #ccc;">${
                    c.phone || "-"
                  }</td>
                  <td style="padding:6px;border:1px solid #ccc;">
                    <button class="select-customer" data-id="${
                      c.user_id
                    }" style="padding:4px 8px;background:#007bff;color:white;border:none;border-radius:4px;cursor:pointer;">Select</button>
                  </td>
                </tr>`
              )
              .join("")}
          </tbody>
        </table>
      `;

      resultsDiv.innerHTML = tableHTML;

      // Handle click on Select buttons
      document.querySelectorAll(".select-customer").forEach((btn) => {
        btn.addEventListener("click", () => {
          const userId = btn.dataset.id;
          idInput.value = userId;
          clearResults(); // Clear the search results after selection
          fetchBtn.click(); // Trigger your existing manual order logic
        });
      });
    } catch (err) {
      console.error("Error searching customers:", err);
      resultsDiv.innerHTML = `<p style="color:red;">⚠️ Error fetching results. Please try again.</p>`;
    }
  });
});

// Handle manual order creation
// document.addEventListener("DOMContentLoaded", () => {
//   const manualBtn = document.getElementById("fetch-customer");
//   const manualPopup = document.getElementById("manual-order-popup");
//   const form = document.getElementById("manual-order-form");
//   const tbody = document.querySelector("#medicine-table tbody");
//   const addMedicine = document.getElementById("add-medicine");
//   const closePopup = document.getElementById("close-popup");

//   let currentUserId = null;

//   manualBtn.addEventListener("click", async () => {
//     const userId = document.getElementById("manual-user-id").value.trim();

//     // if no ID entered, ask to create new customer directly
//     if (!userId) {
//       if (
//         confirm("No Customer ID entered. Do you want to create a new customer?")
//       ) {
//         openManualOrderForm(); // open blank form
//       }
//       return;
//     }

//     try {
//       const res = await fetch(`/api/customers/${userId}`);
//       if (!res.ok) {
//         // if user not found
//         if (
//           confirm(
//             "No customer found with this ID. Do you want to create a new customer?"
//           )
//         ) {
//           openManualOrderForm(); // open blank form
//         }
//         return;
//       }

//       // if user found, prefill details
//       const user = await res.json();
//       currentUserId = user.id;

//       openManualOrderForm(user); // prefill form with customer data
//       document
//         .querySelector("#manual-order-popup")
//         .scrollIntoView({ behavior: "smooth", block: "start" });
//     } catch (err) {
//       alert("Error fetching user: " + err.message);
//     }
//   });

//   // Reusable function for opening the manual order popup
//   function openManualOrderForm(user = null) {
//     const form = document.getElementById("manual-order-form");
//     manualPopup.classList.remove("hidden");

//     // Prefill or clear form
//     document.getElementById("firstName").value = user ? user.first_name : "";
//     document.getElementById("lastName").value = user ? user.last_name : "";
//     document.getElementById("email").value = user ? user.email : "";
//     document.getElementById("phone").value = user ? user.phone : "";
//     document.getElementById("billingStreetAddress").value = user
//       ? user.street_address
//       : "";
//     document.getElementById("billingCity").value = user ? user.city : "";
//     document.getElementById("billingState").value = user ? user.state : "";
//     document.getElementById("billingZip").value = user ? user.zip_code : "";
//     document.getElementById("country").value = user ? user.country : "";

//     // Reset medicine table
//     const tbody = document.querySelector("#medicine-table tbody");
//     tbody.innerHTML = "";
//   }

//   addMedicine.addEventListener("click", () => {
//     const row = document.createElement("tr");
//     row.innerHTML = `
//       <td><input class="name" required></td>
//       <td><input class="mg" required></td>
//       <td><input class="qty" type="number" value="1" required></td>
//       <td><input class="price" type="number" step="0.01" required></td>
//       <td><button type="button" class="remove">❌</button></td>
//         `;
//     row.querySelector(".remove").addEventListener("click", () => row.remove());
//     tbody.appendChild(row);
//   });

//   closePopup.addEventListener("click", () =>
//     manualPopup.classList.add("hidden")
//   );

//   form.addEventListener("submit", async (e) => {
//     e.preventDefault();
//     const medicines = Array.from(tbody.querySelectorAll("tr")).map((row) => ({
//       name: row.querySelector(".name").value,
//       mg: row.querySelector(".mg").value,
//       quantity: row.querySelector(".qty").value,
//       price: row.querySelector(".price").value,
//     }));

//     const data = {
//       userId: currentUserId,
//       firstName: form.firstName.value,
//       lastName: form.lastName.value,
//       email: form.email.value,
//       phone: form.phone.value,
//       billingStreetAddress: form.billingStreetAddress.value,
//       billingCity: form.billingCity.value,
//       billingState: form.billingState.value,
//       billingZip: form.billingZip.value,
//       country: form.country.value,
//       shippingCost: parseFloat(form.shippingCost.value || 0),
//       totalCost: parseFloat(form.totalCost.value || 0),
//       cartItems: medicines,
//     };

//     const res = await fetch("/api/manual-order", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify(data),
//     });

//     const result = await res.json();
//     if (result.success) {
//       alert("✅ Manual order created successfully!");
//       manualPopup.classList.add("hidden");
//     } else {
//       alert("❌ Error: " + result.message);
//     }
//   });
// });

// ========================================
// UPDATED MANUAL ORDER FUNCTIONALITY
// ========================================

document.addEventListener("DOMContentLoaded", () => {
  const manualBtn = document.getElementById("fetch-customer");
  const manualPopup = document.getElementById("manual-order-popup");
  const form = document.getElementById("manual-order-form");
  const tbody = document.querySelector("#medicine-table tbody");
  const addMedicine = document.getElementById("add-medicine");
  const closePopup = document.getElementById("close-popup");

  let currentUserId = null;

  // ✅ Fetch customer button click
  manualBtn.addEventListener("click", async () => {
    const userId = document.getElementById("manual-user-id").value.trim();

    // ✅ If no ID entered, open blank form for new order
    if (!userId) {
      console.log("📝 Opening blank form for new manual order");
      currentUserId = null;
      openManualOrderForm(); // Open blank form
      return;
    }

    // ✅ If ID is provided, try to fetch customer
    try {
      const res = await fetch(`/api/customers/${userId}`);

      if (!res.ok) {
        // Customer not found with this ID
        if (
          confirm(
            "No customer found with this ID. Do you want to create a new order anyway?"
          )
        ) {
          console.log("⚠️ Customer not found, opening blank form");
          currentUserId = null;
          openManualOrderForm(); // Open blank form
        }
        return;
      }

      // ✅ Customer found, prefill form with their data
      const user = await res.json();
      currentUserId = user.id;
      console.log(`✅ Customer found (ID: ${user.id}), prefilling form`);
      openManualOrderForm(user); // Prefill form with customer data

      // Scroll to popup
      document
        .querySelector("#manual-order-popup")
        .scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      console.error("Error fetching customer:", err);
      alert("Error fetching customer: " + err.message);
    }
  });

  // ✅ Function to open manual order form (blank or prefilled)
  function openManualOrderForm(user = null) {
    manualPopup.classList.remove("hidden");
    manualPopup.classList.add("active");

    // Prefill or clear form fields
    document.getElementById("firstName").value = user ? user.first_name : "";
    document.getElementById("lastName").value = user ? user.last_name : "";
    document.getElementById("email").value = user ? user.email : "";
    document.getElementById("phone").value = user ? user.phone : "";
    document.getElementById("billingStreetAddress").value = user
      ? user.street_address
      : "";
    document.getElementById("billingCity").value = user ? user.city : "";
    document.getElementById("billingState").value = user ? user.state : "";
    document.getElementById("billingZip").value = user ? user.zip_code : "";
    document.getElementById("country").value = user ? user.country : "";

    // Reset medicine table
    tbody.innerHTML = "";

    // Reset cost fields
    document.getElementById("shippingCost").value = "0";
    document.getElementById("totalCost").value = "";

    // Show helpful message
    if (user) {
      console.log(
        `📋 Form prefilled for: ${user.first_name} ${user.last_name} (${user.email})`
      );
    } else {
      console.log("📝 Blank form opened - will check email on submit");
    }
  }

  // ✅ Add medicine row
  addMedicine.addEventListener("click", () => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input class="name" required style="width: 100%; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 4px;" /></td>
      <td><input class="mg" required style="width: 100%; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 4px;" /></td>
      <td><input class="qty" type="number" value="1" required style="width: 100%; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 4px;" /></td>
      <td><input class="price" type="number" step="0.01" required style="width: 100%; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 4px;" /></td>
      <td><button type="button" class="remove danger" style="padding: 0.5rem;">✖</button></td>
    `;
    row.querySelector(".remove").addEventListener("click", () => row.remove());
    tbody.appendChild(row);
  });

  // ✅ Close popup
  closePopup.addEventListener("click", () => {
    manualPopup.classList.remove("active");
    manualPopup.classList.add("hidden");
  });

  // ✅ Submit manual order form
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    // Validate email format
    const email = form.email.value.trim();
    if (!email || !email.includes("@")) {
      alert("⚠️ Please enter a valid email address");
      return;
    }

    // Get all medicines
    const medicines = Array.from(tbody.querySelectorAll("tr")).map((row) => ({
      name: row.querySelector(".name").value,
      mg: row.querySelector(".mg").value,
      quantity: row.querySelector(".qty").value,
      price: row.querySelector(".price").value,
    }));

    if (medicines.length === 0) {
      alert("⚠️ Please add at least one medicine");
      return;
    }

    // Prepare order data
    const data = {
      userId: currentUserId, // Will be null if new customer
      firstName: form.firstName.value,
      lastName: form.lastName.value,
      email: email,
      phone: form.phone.value,
      companyName: form.companyName?.value || "",
      billingStreetAddress: form.billingStreetAddress.value,
      apartment: form.apartment?.value || "",
      billingCity: form.billingCity.value,
      billingState: form.billingState.value,
      billingZip: form.billingZip.value,
      country: form.country.value,
      shippingCost: parseFloat(form.shippingCost.value || 0),
      totalCost: parseFloat(form.totalCost.value || 0),
      cartItems: medicines,
    };

    // Show loading state
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML =
      '<i class="fas fa-spinner fa-spin"></i> Processing...';

    try {
      const res = await fetch("/api/manual-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const result = await res.json();

      if (result.success) {
        // Show success message with details
        const msgType = result.isNewCustomer
          ? "New customer created"
          : "Existing customer found";
        const successMsg = `✅ ${msgType}!\n\nOrder ID: ${result.orderId}\nCustomer ID: ${result.userId}\n\n${result.message}`;

        alert(successMsg);
        console.log("✅ Order created:", result);

        // Close popup and reset form
        manualPopup.classList.remove("active");
        manualPopup.classList.add("hidden");
        form.reset();
        tbody.innerHTML = "";
        currentUserId = null;

        // Refresh dashboard if function exists
        if (typeof loadDashboardData === "function") {
          loadDashboardData();
        }
      } else {
        throw new Error(result.message || "Failed to create order");
      }
    } catch (err) {
      console.error("Error creating manual order:", err);
      alert("❌ Error: " + err.message);
    } finally {
      // Restore button state
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnText;
    }
  });

  // ✅ Close popup on background click
  manualPopup.addEventListener("click", (e) => {
    if (e.target === manualPopup) {
      manualPopup.classList.remove("active");
      manualPopup.classList.add("hidden");
    }
  });
});

// Handle product variants loading and editing
document.addEventListener("DOMContentLoaded", () => {
  const lookupInput = document.getElementById("lookup-product-id");
  const loadBtn = document.getElementById("btn-load-variants");
  const table = document.getElementById("variants-table");
  const tbody = table.querySelector("tbody");
  const addBtn = document.getElementById("btn-add-new");

  // Helper to create table cell with input
  function makeCell(value, field) {
    const td = document.createElement("td");
    const inp = document.createElement("input");
    inp.value = value || "";
    inp.dataset.field = field;
    td.appendChild(inp);
    return td;
  }

  // Render a table row for a variant
  function renderRow(variant) {
    const tr = document.createElement("tr");
    tr.dataset.id = variant.variation_id;
    const idTd = document.createElement("td");
    idTd.textContent = variant.variation_id;
    tr.appendChild(idTd);
    tr.appendChild(makeCell(variant.unit_type, "unit_type"));
    tr.appendChild(makeCell(variant.unit_value, "unit_value"));
    tr.appendChild(makeCell(variant.qty, "qty"));
    tr.appendChild(makeCell(variant.price_per_pill, "price_per_pill"));
    tr.appendChild(makeCell(variant.price_per_box, "price_per_box"));
    tr.appendChild(makeCell(variant.offer_price, "offer_price"));
    tr.appendChild(makeCell(variant.delivery_time, "delivery_time"));

    const actTd = document.createElement("td");
    const saveBtn = document.createElement("button");
    const delBtn = document.createElement("button");
    saveBtn.innerHTML = '<i class="fas fa-save"></i> Save';
    delBtn.innerHTML = '<i class="fas fa-trash"></i> Delete';

    saveBtn.addEventListener("click", () => updateVariant(tr));
    delBtn.addEventListener("click", () => {
      if (!confirm(`Really delete this variation? ${tr.dataset.id}`)) return;
      deleteVariant(tr.dataset.id)
        .then(() => {
          tr.remove();
          alert("Variation deleted");
        })
        .catch((err) => {
          console.error(err);
          alert("Delete failed");
        });
    });
    actTd.appendChild(saveBtn);
    actTd.appendChild(delBtn);
    tr.appendChild(actTd);
    return tr;
  }

  // Load variants for given product ID
  loadBtn.addEventListener("click", async () => {
    const pid = lookupInput.value.trim();
    if (!pid) return alert("enter product id");
    const resp = await fetch(`/api/variants/${pid}`);
    const variants = await resp.json();
    tbody.innerHTML = "";
    variants.forEach((v) => tbody.appendChild(renderRow(v)));
    table.style.display = "";
    addBtn.style.display = "";
  });

  // Delete variant by ID
  async function deleteVariant(variationId) {
    const res = await fetch(`/api/variants/${variationId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const { error } = await res.json();
      throw new Error(error || res.statusText);
    }
  }

  // Update variant from row inputs
  async function updateVariant(row) {
    const id = row.dataset.id;
    if (!/^\d+$/.test(id))
      return alert("Cannot update — no valid variation ID yet. Use Create.");
    const payload = {};
    row.querySelectorAll("input").forEach((inp) => {
      payload[inp.dataset.field] = inp.value;
    });
    try {
      const res = await fetch(`/api/variants/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(res.statusText);
      alert("Updated");
    } catch (err) {
      console.error("updateVariant error", err);
      alert("Update failed: " + err.message);
    }
  }

  // Add new variant row
  addBtn.addEventListener("click", () => {
    const pid = lookupInput.value.trim();
    const empty = {
      variation_id: "",
      unit_type: "",
      unit_value: "",
      qty: "",
      price_per_pill: "",
      price_per_box: "",
      offer_price : "",
      delivery_time: "",
    };
    const newRow = renderRow(empty);
    const createBtn = document.createElement("button");
    createBtn.innerHTML = '<i class="fas fa-plus"></i> Create';
    createBtn.addEventListener("click", () => createVariant(newRow, pid));
    const actionCell = newRow.querySelector("td:last-child");
    actionCell.appendChild(createBtn);
    tbody.appendChild(newRow);
  });

  // Create variant from row inputs
  async function createVariant(row, pid) {
    const payload = { product_id: +pid };
    row.querySelectorAll("input").forEach((inp) => {
      payload[inp.dataset.field] = inp.value;
    });
    try {
      const res = await fetch(`/api/variants`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(res.statusText);
      const created = await res.json();
      tbody.replaceChild(renderRow(created), row);
      alert("Created");
    } catch (err) {
      console.error("createVariant error", err);
      alert("Create failed: " + err.message);
    }
  }
});

// Handle customer tracking
document.addEventListener("DOMContentLoaded", () => {
  const trackBtn = document.getElementById("btn-track-customer");
  const userIdInput = document.getElementById("tracking-user-id");
  const resultsDiv = document.getElementById("tracking-results");

  // Track customer button click
  trackBtn.addEventListener("click", async () => {
    const userId = userIdInput.value.trim();
    if (!userId) {
      alert("Please enter a Customer ID");
      return;
    }

    try {
      trackBtn.textContent = "Loading...";
      trackBtn.disabled = true;
      const response = await fetch(`/api/customer-tracking/${userId}`);
      const result = await response.json();

      if (!response.ok)
        throw new Error(result.message || "Failed to fetch customer data");
      if (!result.success)
        throw new Error(result.message || "Customer not found");

      const { customer, orders, totalOrders, totalSpent } = result.data;
      document.getElementById("track-customer-id").textContent = customer.id;
      document.getElementById(
        "track-customer-name"
      ).textContent = `${customer.first_name} ${customer.last_name}`;
      document.getElementById("track-customer-email").textContent =
        customer.email;
      document.getElementById("track-customer-phone").textContent =
        customer.phone;
      document.getElementById("track-customer-company").textContent =
        customer.company_name || "N/A";
      document.getElementById("track-customer-address").textContent = `${
        customer.street_address
      }, ${customer.apartment || ""}, ${customer.city}, ${customer.state}, ${
        customer.zip_code
      }, ${customer.country}`;
      document.getElementById("track-total-orders").textContent = totalOrders;
      document.getElementById(
        "track-lifetime-value"
      ).textContent = `${totalSpent}`;

      const ordersListDiv = document.getElementById("orders-list");
      ordersListDiv.innerHTML = "";

      if (orders.length === 0) {
        ordersListDiv.innerHTML =
          '<div class="no-orders">No orders found for this customer</div>';
      } else {
        orders.forEach((order) => {
          const orderCard = document.createElement("div");
          orderCard.className = "order-card";
          const orderDate = new Date(order.created_at);
          const formattedDate = orderDate.toLocaleString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });

          let itemsHtml = "";
          if (order.items.length > 0) {
            itemsHtml = `<table class="order-items-table"><thead><tr><th>Product Name</th><th>Strength (mg)</th><th>Quantity</th><th>Price</th></tr></thead><tbody>${order.items
              .map(
                (item) =>
                  `<tr><td>${item.name}</td><td>${item.mg}</td><td>${
                    item.quantity
                  }</td><td>${parseFloat(item.price).toFixed(2)}</td></tr>`
              )
              .join("")}</tbody></table>`;
          }

          // orderCard.innerHTML = `
          //         <div class="order-header">
          //           <div>
          //             <div class="order-number">Order #${order.order_id}</div>
          //             <div class="order-date"><strong>Date</strong> : ${formattedDate}</div>
          //           </div>
          //           <div class="order-total"><strong>Price</strong> : ${parseFloat(
          //             order.total_amount
          //           ).toFixed(2)}</div>
          //         </div>
          //         ${itemsHtml}
          //         <div style="margin-top: 10px; font-size: 13px; color: #666;">
          //           <strong>Shipping:</strong> ${parseFloat(
          //             order.shipping
          //           ).toFixed(2)} |
          //           <strong>Items:</strong> ${order.itemCount} |
          //           <strong>Payment:</strong> ${order.payment_status}
          //         </div>
          //         <button onclick="deleteRequest(${order.order_id})"
          //               style="background: linear-gradient(135deg, #ef4444, #dc2626);">
          //           <i class="fas fa-trash"></i> Delete
          //       </button>

          //       `;

          // inside your orders.forEach((order) => { ... })
          orderCard.innerHTML = `
            <div class="order-header">
              <div>
                <div class="order-number">Order #${order.order_id}</div>
                <div class="order-date"><strong>Date</strong> : ${formattedDate}</div>
              </div>
              <div class="order-total"><strong>Price</strong> : ${parseFloat(
                order.total_amount
              ).toFixed(2)}</div>
            </div>
            ${itemsHtml}
            <div style="margin-top: 10px; font-size: 13px; color: #666;">
              <strong>Shipping:</strong> ${parseFloat(order.shipping).toFixed(
                2
              )} |
              <strong>Items:</strong> ${order.itemCount} |
              <strong>Payment:</strong> ${generateStatusDropdown(
                order.order_id,
                order.payment_status || "pending"
              )}
            </div>
            <!-- Tracking Input + Send Button -->
            <div style="margin-top:10px; display:flex; gap:8px; align-items:center;">
              <input 
                type="text" 
                id="track-ct-${order.order_id}"
                placeholder="Tracking Number" 
                style="padding:6px; border:1px solid #ccc; border-radius:5px; width:160px;"
              />
              <button 
                onclick="sendTrackingEmail(${order.order_id}, ${
            customer.id
          }, 'track-ct-${order.order_id}')"
                style="background:#2563eb; color:white; padding:6px 12px; border-radius:5px; border:none; cursor:pointer;">
                Send Tracking
              </button>
            </div>
            <div style="margin-top:8px; display:flex; gap:8px; align-items:center;">
              <button onclick="deleteRequest(${order.order_id})"
                      style="background: linear-gradient(135deg, #ef4444, #dc2626);">
                <i class="fas fa-trash"></i> Delete
              </button>
            </div>
          `;
          ordersListDiv.appendChild(orderCard);
        });
      }
      resultsDiv.style.display = "block";
    } catch (error) {
      console.error("Error tracking customer:", error);
      alert(error.message || "Error fetching customer data. Please try again.");
    } finally {
      trackBtn.textContent = "Track Customer";
      trackBtn.disabled = false;
    }
  });

  // Allow Enter key to trigger tracking
  userIdInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") trackBtn.click();
  });
});

// Status configuration
const STATUS_CONFIG = {
  pending: {
    label: "Pending",
    icon: "fa-clock",
    class: "status-pending",
  },
  paid: {
    label: "Paid",
    icon: "fa-check-circle",
    class: "status-paid",
  },
  process: {
    label: "process",
    icon: "fa-cog",
    class: "status-processing",
  },
  tracking: {
    label: "In Transit",
    icon: "fa-shipping-fast",
    class: "status-tracking",
  },
  delivered: {
    label: "Delivered",
    icon: "fa-box-open",
    class: "status-delivered",
  },
  completed: {
    label: "completed",
    icon: "fa-times-circle",
    class: "status-delivered",
  },
};

// Toggle dropdown visibility
window.toggleStatusDropdown = function (button) {
  const dropdown = button.closest(".status-dropdown");
  const allDropdowns = document.querySelectorAll(".status-dropdown");

  // Close all other dropdowns
  allDropdowns.forEach((d) => {
    if (d !== dropdown) d.classList.remove("active");
  });

  // Toggle current dropdown
  dropdown.classList.toggle("active");
};

// Close dropdowns when clicking outside
document.addEventListener("click", (e) => {
  if (!e.target.closest(".status-dropdown")) {
    document.querySelectorAll(".status-dropdown").forEach((d) => {
      d.classList.remove("active");
    });
  }
});

// Update order status
window.updateOrderStatus = async function (orderId, newStatus, optionElement) {
  const dropdown = optionElement.closest(".status-dropdown");
  const statusBtn = dropdown.querySelector(".status-btn");
  const currentStatus = dropdown.dataset.currentStatus;

  // Don't update if same status
  if (currentStatus === newStatus) {
    dropdown.classList.remove("active");
    return;
  }

  // Add loading state
  statusBtn.classList.add("loading");
  dropdown.classList.remove("active");

  try {
    // Make API call to update status
    const response = await fetch(`/api/orders/${orderId}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: newStatus,
        payment_status: newStatus,
      }),
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.message || "Failed to update status");
    }

    // Update UI
    updateStatusUI(dropdown, statusBtn, newStatus);

    // Show success toast
    showToast(
      `Order #${orderId} status updated to ${STATUS_CONFIG[newStatus].label}`,
      "success"
    );

    // Refresh dashboard data
    if (typeof loadDashboardData === "function") {
      loadDashboardData();
    }
  } catch (error) {
    console.error("Error updating status:", error);
    showToast("Failed to update status: " + error.message, "error");
  } finally {
    statusBtn.classList.remove("loading");
  }
};

// Update status UI after successful update
function updateStatusUI(dropdown, statusBtn, newStatus) {
  const config = STATUS_CONFIG[newStatus];

  // Update button
  statusBtn.className = `status-btn ${config.class}`;
  statusBtn.querySelector(".status-text").textContent = config.label;
  statusBtn.querySelector("i:first-child").className = `fas ${config.icon}`;

  // Update dropdown data
  dropdown.dataset.currentStatus = newStatus;

  // Update menu options
  const menu = dropdown.querySelector(".status-menu");
  menu.querySelectorAll(".status-option").forEach((option) => {
    option.classList.remove("current");
  });
  menu.querySelector(`.status-option.${newStatus}`).classList.add("current");
}

// Show toast notification
function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
        <i class="fas ${
          type === "success" ? "fa-check-circle" : "fa-exclamation-circle"
        }"></i>
        <div>
            <strong>${type === "success" ? "Success!" : "Error"}</strong>
            <p style="margin: 4px 0 0 0; font-size: 13px; color: #6c757d;">${message}</p>
        </div>
    `;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("hiding");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Generate status dropdown HTML
function generateStatusDropdown(orderId, currentStatus = "pending") {
  const config = STATUS_CONFIG[currentStatus] || STATUS_CONFIG.pending;

  return `
        <div class="status-dropdown" data-order-id="${orderId}" data-current-status="${currentStatus}">
            <button class="status-btn ${
              config.class
            }" onclick="toggleStatusDropdown(this)">
                <span>
                    <i class="fas ${config.icon}"></i>
                    <span class="status-text">${config.label}</span>
                </span>
                <i class="fas fa-chevron-down"></i>
            </button>
            <div class="status-menu">
                ${Object.keys(STATUS_CONFIG)
                  .map(
                    (status) => `
                    <div class="status-option ${status} ${
                      status === currentStatus ? "current" : ""
                    }" 
                         onclick="updateOrderStatus(${orderId}, '${status}', this)">
                        <i class="fas ${STATUS_CONFIG[status].icon}"></i>
                        <span>${STATUS_CONFIG[status].label}</span>
                    </div>
                `
                  )
                  .join("")}
            </div>
        </div>
    `;
}

// Handle order processing and pagination
document.addEventListener("DOMContentLoaded", () => {
  const tableBody = document.querySelector("#process-requests tbody");
  const orderDetailsSection = document.getElementById("order-details");
  const orderDetailsBody = document.getElementById("order-details-body");
  const customerDetailsSection = document.getElementById("customer-details");
  const customerDetailsBody = document.getElementById("customer-details-body");
  const closeDetailsButton = document.getElementById("close-details");
  const closeCustomerDetailsButton = document.getElementById(
    "close-customer-details"
  );
  const paginationDiv = document.createElement("div");
  paginationDiv.id = "pagination";
  document.getElementById("process-requests").appendChild(paginationDiv);

  let pages = [];
  let currentPage = 1;

  // Fetch and group requests by date
  const fetchRequests = async () => {
    try {
      const response = await fetch(`/api/requests`);
      const requests = await response.json();
      const grouped = {};
      requests.forEach((order) => {
        const date = new Date(order.created_at).toISOString().split("T")[0];
        if (!grouped[date]) grouped[date] = [];
        grouped[date].push(order);
      });

      Object.keys(grouped).forEach((date) => {
        grouped[date].forEach((order, index) => {
          order.serial = index + 1;
        });
      });

      pages = [];
      Object.keys(grouped)
        .sort((a, b) => new Date(b) - new Date(a))
        .forEach((date) => {
          const orders = grouped[date];
          for (let i = 0; i < orders.length; i += 10) {
            pages.push({ date, orders: orders.slice(i, i + 10) });
          }
        });

      renderPage(1);
    } catch (err) {
      console.error("Error fetching requests:", err);
    }
  };

  // Initial fetch
  function renderPage(pageNumber) {
    currentPage = pageNumber;
    tableBody.innerHTML = "";
    const page = pages[pageNumber - 1];
    if (!page) return;

    const headerRow = document.createElement("tr");
    headerRow.innerHTML = `<td colspan="6" style="font-weight:bold; background:var(--light-gray); text-align:center;">Orders for ${page.date}</td>`;
    tableBody.appendChild(headerRow);

    page.orders.forEach((request) => {
      const row = document.createElement("tr");
      const paymentStatus =
        request.payment_status || request.status || "pending";

      let name_or_id = " ";
      if (request.customer_first_name == null) {
        name_or_id = "#" + request.order_id;
      } else {
        name_or_id =
          request.customer_first_name + " " + request.customer_last_name;
      }

      // ✅ NEW: Use the status dropdown instead of old badge
      const statusDropdownHTML = generateStatusDropdown(
        request.order_id,
        paymentStatus
      );

      //This code was used to delete order requests If neend add this into the future code ...
      // <button onclick="deleteRequest(${request.order_id})"
      //                   style="background: linear-gradient(135deg, #ef4444, #dc2626);">
      //               <i class="fas fa-trash"></i> Delete
      // </button>

      row.innerHTML = `
            <td>${request.serial}</td>
            <td>${name_or_id}</td>
            <td>${request.user_id}</td>
            <td>$${parseFloat(request.total_amount).toFixed(2)}</td>
            <td>${statusDropdownHTML}</td>
            <td class="action">

                <button class="view-details-btn" onclick="openDetailsModal(${
                  request.order_id
                }, ${request.user_id})">

                    <i class="fas fa-eye"></i> View Details
                </button>
                
                <input type="text" id="track-${
                  request.order_id
                }" placeholder="Tracking No" style="margin-top:5px; width:120px;" />
                <button onclick="sendTrackingEmail(${request.order_id}, ${
        request.user_id
      })" 
                    style="background: linear-gradient(135deg, #3b82f6, #2563eb); margin-top:5px;">
                    <i class="fas fa-envelope"></i> Send Tracking
                </button>
                <button onclick="deleteRequest(${request.order_id})"
                        style="background: linear-gradient(135deg, #ef4444, #dc2626);">
                    <i class="fas fa-trash"></i> Delete
                </button>
            </td>
        `;
      tableBody.appendChild(row);
    });

    const emptyRows = 10 - page.orders.length;
    for (let i = 0; i < emptyRows; i++) {
      const empty = document.createElement("tr");
      empty.innerHTML = `<td colspan="6">&nbsp;</td>`;
      tableBody.appendChild(empty);
    }

    renderPagination();
    // Scroll to top of table
    // document
    //   .querySelector("#process-requests")
    //   .scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Generate page numbers with ellipses
  function getPageNumbers() {
    const delta = 2;
    const range = [];
    const rangeWithDots = [];
    let l;
    range.push(1);
    for (let i = currentPage - delta; i <= currentPage + delta; i++) {
      if (i > 1 && i < pages.length) range.push(i);
    }
    if (pages.length > 1) range.push(pages.length);
    for (let i of range) {
      if (l) {
        if (i - l === 2) rangeWithDots.push(l + 1);
        else if (i - l !== 1) rangeWithDots.push("...");
      }
      rangeWithDots.push(i);
      l = i;
    }
    return rangeWithDots;
  }

  // Render pagination controls
  function renderPagination() {
    paginationDiv.innerHTML = "";
    const totalPages = pages.length;
    if (totalPages <= 1) return;

    const prevBtn = document.createElement("button");
    prevBtn.className = "pagination-btn nav-btn";
    prevBtn.innerHTML = '<i class="fas fa-chevron-left"></i> Previous';
    prevBtn.onclick = () => renderPage(currentPage - 1);
    prevBtn.disabled = currentPage === 1;
    paginationDiv.appendChild(prevBtn);

    const pageNumbers = getPageNumbers();
    pageNumbers.forEach((pageNum) => {
      if (pageNum === "...") {
        const ellipsis = document.createElement("span");
        ellipsis.className = "pagination-ellipsis";
        ellipsis.textContent = "...";
        paginationDiv.appendChild(ellipsis);
      } else {
        const pageBtn = document.createElement("button");
        pageBtn.className = "pagination-btn";
        pageBtn.textContent = pageNum;
        if (pageNum === currentPage) pageBtn.classList.add("active");
        pageBtn.onclick = () => renderPage(pageNum);
        paginationDiv.appendChild(pageBtn);
      }
    });

    const nextBtn = document.createElement("button");
    nextBtn.className = "pagination-btn nav-btn";
    nextBtn.innerHTML = 'Next <i class="fas fa-chevron-right"></i>';
    nextBtn.onclick = () => renderPage(currentPage + 1);
    nextBtn.disabled = currentPage === totalPages;
    paginationDiv.appendChild(nextBtn);
  }

  // Mark payment as done
  window.markPaymentDone = async (orderId, buttonElement) => {
    if (!confirm("Mark this payment as completed?")) return;
    buttonElement.disabled = true;
    buttonElement.textContent = "Processing...";
    try {
      const response = await fetch(`/api/orders/${orderId}/payment-status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.message || "Failed to update payment status");
      if (result.success) {
        alert("✅ Payment marked as completed!");
        fetchRequests();
      } else {
        throw new Error(result.message || "Update failed");
      }
    } catch (err) {
      console.error("Error updating payment status:", err);
      alert("❌ Error: " + err.message);
      buttonElement.disabled = false;
      buttonElement.textContent = "💰 Payment Done";
    }
  };

  // Send tracking email
  window.sendTrackingEmail = async (
    orderId,
    userId,
    inputId = `track-${orderId}`
  ) => {
    const input = document.getElementById(inputId);
    const trackingNumber = input.value.trim();
    if (!trackingNumber) {
      alert("⚠️ Please enter a tracking number first.");
      return;
    }
    try {
      const response = await fetch(`/api/orders/${orderId}/send-tracking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trackingNumber, userId }),
      });
      const result = await response.json();
      console.log("Here is yuo result ",result);
      if (!response.ok || !result.success)
        throw new Error(result.message || "Failed to send tracking email");
      alert("📧 Tracking email sent successfully!");
      input.value = "";
    } catch (err) {
      console.error("Error sending tracking email:", err);
      alert("❌ Could not send email: " + err.message);
    }
  };

  // View order items in details modal
  window.viewOrderItems = async (orderId) => {
    try {
      const response = await fetch(`/api/order-items/${orderId}`);
      const orderItems = await response.json();
      orderDetailsBody.innerHTML = "";
      orderItems.forEach((item) => {
        const row = document.createElement("tr");
        row.innerHTML = `
                <td>${item.name}</td>
                <td>${item.quantity}</td>
                <td>${item.mg}</td>
                <td>${parseFloat(item.price).toFixed(2)}</td>
              `;
        orderDetailsBody.appendChild(row);
      });
      orderDetailsSection.classList.remove("hidden");
    } catch (err) {
      console.error("Error fetching order items:", err);
    }
  };

  // View customer details in modal
  window.viewCustomerDetails = async (id) => {
    try {
      const response = await fetch(`/api/customers/${id}`);
      const customer = await response.json();
      customerDetailsBody.innerHTML = `
              <p><strong>Name:</strong> ${customer.first_name} ${
        customer.last_name
      }</p>
              <p><strong>Email:</strong> ${customer.email}</p>
              <p><strong>Phone:</strong> ${customer.phone}</p>
              <p><strong>Address:</strong> ${customer.street_address}, ${
        customer.apartment || ""
      }, ${customer.city}, ${customer.state}, ${customer.zip_code}</p>
              <p><strong>Company:</strong> ${customer.company_name || "N/A"}</p>
            `;
      customerDetailsSection.classList.remove("hidden");
    } catch (err) {
      console.error("Error fetching customer details:", err);
    }
  };

  // Delete request
  window.deleteRequest = async (orderId) => {
    if (!confirm("Are you sure you want to delete this order?")) return;
    try {
      const res = await fetch(`/api/requests/${orderId}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "Delete failed");
      alert(json.message);
      fetchRequests();
    } catch (err) {
      console.error("Error deleting request:", err);
      alert("Could not delete order: " + err.message);
    }
  };

  // Close modals
  closeDetailsButton.addEventListener("click", () => {
    orderDetailsSection.classList.add("hidden");
  });

  closeCustomerDetailsButton.addEventListener("click", () => {
    customerDetailsSection.classList.add("hidden");
  });

  fetchRequests();
});

// Order Details Modal
async function openDetailsModal(orderId, userId) {
  const modal = document.getElementById("detailsModal");
  const modalBody = document.getElementById("modalBodyContent");
  modal.classList.add("active");
  modalBody.innerHTML = `<div class="loading-spinner"><div class="spinner"></div></div>`;

  try {
    // ✅ Fetch order items and order customer (with automatic fallback)
    const [orderItemsResponse, orderCustomerResponse] = await Promise.all([
      fetch(`/api/order-items/${orderId}`),
      fetch(`/api/order-customer/${orderId}`), // Automatically uses snapshot or fallback
    ]);

    if (!orderItemsResponse.ok || !orderCustomerResponse.ok) {
      throw new Error("Failed to fetch data");
    }

    const orderItems = await orderItemsResponse.json();
    const customer = await orderCustomerResponse.json();

    // Optional: Show where data came from (for debugging)
    console.log(`Order ${orderId} data source:`, customer.data_source);

    renderDetailsContent(orderItems, customer, orderId);
  } catch (error) {
    console.error("Error fetching details:", error);
    modalBody.innerHTML = `<div class="error-message">Failed to load details. Please try again.</div>`;
  }
}

// Render content inside details modal
function renderDetailsContent(orderItems, customer, orderId) {
  const modalBody = document.getElementById("modalBodyContent");
  const total = orderItems.reduce(
    (sum, item) => sum + parseFloat(item.price),
    0
  );

  modalBody.innerHTML = `
          <div class="details-grid">
            <div class="detail-section">
              <h3><i class="fas fa-user"></i> Customer Information</h3>
              <div class="info-grid">
                <div class="info-row">
                  <div class="info-label">Name:</div>
                  <div class="info-value">${customer.first_name} ${
    customer.last_name
  }</div>
                </div>
                <div class="info-row">
                  <div class="info-label">Email:</div>
                  <div class="info-value">${customer.email}</div>
                </div>
                <div class="info-row">
                  <div class="info-label">Phone:</div>
                  <div class="info-value">${customer.phone}</div>
                </div>
                <div class="info-row">
                  <div class="info-label">Company:</div>
                  <div class="info-value">${
                    customer.company_name || "N/A"
                  }</div>
                </div>
                <div class="info-row">
                  <div class="info-label">Address:</div>
                  <div class="info-value">${customer.street_address}, ${
    customer.apartment ? customer.apartment + ", " : ""
  }${customer.city}, ${customer.state}, ${customer.zip_code}, ${
    customer.country
  }</div>
                </div>
              </div>
            </div>
            
            <div class="detail-section">
              <h3><i class="fas fa-clipboard-list"></i> Order Summary</h3>
              <div class="info-grid">
                <div class="info-row">
                  <div class="info-label">Order ID:</div>
                  <div class="info-value">#${orderId}</div>
                </div>
                <div class="info-row">
                  <div class="info-label">Total Items:</div>
                  <div class="info-value">${orderItems.length}</div>
                </div>
                <div class="info-row">
                  <div class="info-label">Total Amount:</div>
                  <div class="info-value price">${total.toFixed(2)}</div>
                </div>
              </div>
            </div>
            
            <div class="detail-section order-items-section">
              <h3><i class="fas fa-box-open"></i> Order Items</h3>
              <table class="items-table">
                <thead>
                  <tr>
                    <th>Product Name</th>
                    <th>Strength (mg)</th>
                    <th>Quantity</th>
                    <th>Price</th>
                  </tr>
                </thead>
                <tbody>
                  ${orderItems
                    .map(
                      (item) => `
                    <tr>
                      <td>${item.name}</td>
                      <td>${item.mg}</td>
                      <td>${item.quantity}</td>
                      <td class="price">${parseFloat(item.price).toFixed(
                        2
                      )}</td>
                    </tr>
                  `
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          </div>
        `;
}

// Close details modal
function closeDetailsModal() {
  document.getElementById("detailsModal").classList.remove("active");
}

document.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("detailsModal")
    .addEventListener("click", function (e) {
      if (e.target === this) closeDetailsModal();
    });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeDetailsModal();
  });
});

// ========================================
// NAVIGATION FUNCTIONALITY
// ========================================

document.addEventListener("DOMContentLoaded", function () {
  const navItems = document.querySelectorAll(".nav-item");
  const sections = document.querySelectorAll("section[id]");

  document.documentElement.style.scrollBehavior = "smooth";

  function getOptimalScrollPosition(element) {
    const headerHeight = document.querySelector("header").offsetHeight;
    const scrollOffset = 80;
    const elementTop = element.offsetTop;
    const scrollPosition = elementTop - headerHeight - scrollOffset;
    return Math.max(0, scrollPosition);
  }

  navItems.forEach((item) => {
    item.addEventListener("click", function (e) {
      e.preventDefault();

      navItems.forEach((nav) => {
        nav.classList.remove("active");
        nav.setAttribute("aria-current", "false");
      });

      this.classList.add("active");
      this.setAttribute("aria-current", "page");

      const targetId = this.getAttribute("href");

      if (targetId && targetId.startsWith("#")) {
        const targetSection = document.querySelector(targetId);

        if (targetSection) {
          sections.forEach((s) => s.classList.remove("active-section"));

          const scrollPosition = getOptimalScrollPosition(targetSection);

          window.scrollTo({
            top: scrollPosition,
            behavior: "smooth",
          });

          setTimeout(() => {
            targetSection.classList.add("active-section");
          }, 300);

          history.pushState(null, null, targetId);
        }
      }
    });
  });

  // Handle initial hash
  const hash = window.location.hash;
  if (hash) {
    setTimeout(() => {
      const targetSection = document.querySelector(hash);
      if (targetSection) {
        const scrollPosition = getOptimalScrollPosition(targetSection);
        window.scrollTo({
          top: scrollPosition,
          behavior: "smooth",
        });

        navItems.forEach((item) => {
          item.classList.remove("active");
          if (item.getAttribute("href") === hash) {
            item.classList.add("active");
            item.setAttribute("aria-current", "page");
          }
        });
      }
    }, 100);
  }

  // Mobile sidebar toggle
  const sidebar = document.querySelector(".sidebar");
  const mainWrapper = document.querySelector(".main-wrapper");

  if (window.innerWidth <= 768) {
    const hamburgerBtn = document.createElement("button");
    hamburgerBtn.innerHTML = '<i class="fas fa-bars"></i>';
    hamburgerBtn.style.cssText = `
          position: fixed;
          top: 1rem;
          left: 1rem;
          width: 45px;
          height: 45px;
          border-radius: 8px;
          background: var(--primary);
          color: white;
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1001;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
        `;

    document.body.appendChild(hamburgerBtn);

    hamburgerBtn.addEventListener("click", function () {
      sidebar.classList.toggle("show");
    });

    mainWrapper.addEventListener("click", function () {
      if (sidebar.classList.contains("show")) {
        sidebar.classList.remove("show");
      }
    });
  }
});

// ========================================
// STATUS DROPDOWN FUNCTIONALITY
// ========================================

// Only define if not already defined in empolyee.js
if (typeof STATUS_CONFIG === "undefined") {
  window.STATUS_CONFIG = {
    pending: { label: "Pending", icon: "fa-clock", class: "status-pending" },
    paid: { label: "Paid", icon: "fa-check-circle", class: "status-paid" },
    process: {
      label: "Processing",
      icon: "fa-cog",
      class: "status-processing",
    },
    tracking: {
      label: "In Transit",
      icon: "fa-shipping-fast",
      class: "status-tracking",
    },
    delivered: {
      label: "Delivered",
      icon: "fa-box-open",
      class: "status-delivered",
    },
    completed: {
      label: "Completed",
      icon: "fa-check-double",
      class: "status-cancelled",
    },
  };
}

// Toggle dropdown visibility - only define if not already defined
if (typeof window.toggleStatusDropdown === "undefined") {
  window.toggleStatusDropdown = function (button) {
    const dropdown = button.closest(".status-dropdown");
    const allDropdowns = document.querySelectorAll(".status-dropdown");

    // Close all other dropdowns
    allDropdowns.forEach((d) => {
      if (d !== dropdown) d.classList.remove("active");
    });

    // Toggle current dropdown
    dropdown.classList.toggle("active");
  };
}

// Close dropdowns when clicking outside
document.addEventListener("click", (e) => {
  if (!e.target.closest(".status-dropdown")) {
    document.querySelectorAll(".status-dropdown").forEach((d) => {
      d.classList.remove("active");
    });
  }
});

// Update order status - only define if not already defined
if (typeof window.updateOrderStatus === "undefined") {
  window.updateOrderStatus = async function (
    orderId,
    newStatus,
    optionElement
  ) {
    const dropdown = optionElement.closest(".status-dropdown");
    const statusBtn = dropdown.querySelector(".status-btn");
    const currentStatus = dropdown.dataset.currentStatus;

    if (currentStatus === newStatus) {
      dropdown.classList.remove("active");
      return;
    }

    statusBtn.disabled = true;
    dropdown.classList.remove("active");

    try {
      const response = await fetch(`/api/orders/${orderId}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus, payment_status: newStatus }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to update status");
      }

      if (typeof updateStatusUI === "function") {
        updateStatusUI(dropdown, statusBtn, newStatus);
      }

      if (typeof showToast === "function") {
        showToast(
          `Order #${orderId} status updated to ${
            (window.STATUS_CONFIG || STATUS_CONFIG)[newStatus].label
          }`,
          "success"
        );
      }

      if (typeof loadDashboardData === "function") {
        loadDashboardData();
      }
    } catch (error) {
      console.error("Error updating status:", error);
      if (typeof showToast === "function") {
        showToast("Failed to update status: " + error.message, "error");
      }
    } finally {
      statusBtn.disabled = false;
    }
  };
}

// Update status UI - only define if not already defined
if (typeof window.updateStatusUI === "undefined") {
  window.updateStatusUI = function (dropdown, statusBtn, newStatus) {
    const STATUS_REF = window.STATUS_CONFIG || STATUS_CONFIG;
    const config = STATUS_REF[newStatus];
    statusBtn.className = `status-btn ${config.class}`;
    statusBtn.querySelector(".status-text").textContent = config.label;
    statusBtn.querySelector("i:first-child").className = `fas ${config.icon}`;
    dropdown.dataset.currentStatus = newStatus;

    const menu = dropdown.querySelector(".status-menu");
    menu.querySelectorAll(".status-option").forEach((option) => {
      option.classList.remove("current");
    });
    menu.querySelector(`.status-option.${newStatus}`)?.classList.add("current");
  };
}

// Generate status dropdown HTML - only define if not already defined
if (typeof window.generateStatusDropdown === "undefined") {
  window.generateStatusDropdown = function (
    orderId,
    currentStatus = "pending"
  ) {
    const STATUS_REF = window.STATUS_CONFIG || STATUS_CONFIG;
    const config = STATUS_REF[currentStatus] || STATUS_REF.pending;

    return `
          <div class="status-dropdown" data-order-id="${orderId}" data-current-status="${currentStatus}">
            <button class="status-btn ${
              config.class
            }" onclick="toggleStatusDropdown(this)">
              <span>
                <i class="fas ${config.icon}"></i>
                <span class="status-text">${config.label}</span>
              </span>
              <i class="fas fa-chevron-down"></i>
            </button>
            <div class="status-menu">
              ${Object.keys(STATUS_REF)
                .map(
                  (status) => `
                <div class="status-option ${status} ${
                    status === currentStatus ? "current" : ""
                  }" 
                     onclick="updateOrderStatus(${orderId}, '${status}', this)">
                  <i class="fas ${STATUS_REF[status].icon}"></i>
                  <span>${STATUS_REF[status].label}</span>
                </div>
              `
                )
                .join("")}
            </div>
          </div>
        `;
  };
}

// ========================================
// TOAST NOTIFICATION
// ========================================

// Only define if not already defined in empolyee.js
if (typeof window.showToast === "undefined") {
  window.showToast = function (message, type = "success") {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = `
          <i class="fas ${
            type === "success" ? "fa-check-circle" : "fa-exclamation-circle"
          }"></i>
          <div>
            <strong>${type === "success" ? "Success!" : "Error"}</strong>
            <p style="margin: 4px 0 0 0; font-size: 13px; color: #6c757d;">${message}</p>
          </div>
        `;

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("hiding");
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  };
}

// ========================================
// DETAILS MODAL FUNCTIONALITY
// ========================================

function closeDetailsModal() {
  document.getElementById("detailsModal").classList.remove("active");
}

window.openDetailsModal = async function (orderId, userId) {
  const modal = document.getElementById("detailsModal");
  const modalBody = document.getElementById("modalBodyContent");
  modal.classList.add("active");
  modalBody.innerHTML =
    '<div class="loading-spinner"><div class="spinner"></div></div>';

  try {
    const [orderItemsResponse, orderCustomerResponse] = await Promise.all([
      fetch(`/api/order-items/${orderId}`),
      fetch(`/api/order-customer/${orderId}`),
    ]);

    if (!orderItemsResponse.ok || !orderCustomerResponse.ok) {
      throw new Error("Failed to fetch data");
    }

    const orderItems = await orderItemsResponse.json();
    const customer = await orderCustomerResponse.json();

    renderDetailsContent(orderItems, customer, orderId);
  } catch (error) {
    console.error("Error fetching details:", error);
    modalBody.innerHTML =
      '<div style="color: var(--danger); padding: 2rem; text-align: center;">Failed to load details. Please try again.</div>';
  }
};

function renderDetailsContent(orderItems, customer, orderId) {
  const modalBody = document.getElementById("modalBodyContent");
  const total = orderItems.reduce(
    (sum, item) => sum + parseFloat(item.price),
    0
  );

  modalBody.innerHTML = `
        <div class="details-grid">
          <div class="detail-section">
            <h3><i class="fas fa-user"></i> Customer Information</h3>
            <div class="info-grid">
              <div class="info-row">
                <div class="info-label">Name:</div>
                <div class="info-value">${customer.first_name} ${
    customer.last_name
  }</div>
              </div>
              <div class="info-row">
                <div class="info-label">Email:</div>
                <div class="info-value">${customer.email}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Phone:</div>
                <div class="info-value">${customer.phone}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Company:</div>
                <div class="info-value">${customer.company_name || "N/A"}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Address:</div>
                <div class="info-value">${customer.street_address}, ${
    customer.apartment ? customer.apartment + ", " : ""
  }${customer.city}, ${customer.state}, ${customer.zip_code}, ${
    customer.country
  }</div>
              </div>
            </div>
          </div>
          
          <div class="detail-section">
            <h3><i class="fas fa-clipboard-list"></i> Order Summary</h3>
            <div class="info-grid">
              <div class="info-row">
                <div class="info-label">Order ID:</div>
                <div class="info-value">#${orderId}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Total Items:</div>
                <div class="info-value">${orderItems.length}</div>
              </div>
              <div class="info-row">
                <div class="info-label">Total Amount:</div>
                <div class="info-value price">${total.toFixed(2)}</div>
              </div>
            </div>
          </div>
          
          <div class="detail-section">
            <h3><i class="fas fa-box-open"></i> Order Items</h3>
            <table class="items-table">
              <thead>
                <tr>
                  <th>Product Name</th>
                  <th>Strength (mg)</th>
                  <th>Quantity</th>
                  <th>Price</th>
                </tr>
              </thead>
              <tbody>
                ${orderItems
                  .map(
                    (item) => `
                  <tr>
                    <td>${item.name}</td>
                    <td>${item.mg}</td>
                    <td>${item.quantity}</td>
                    <td class="price">${parseFloat(item.price).toFixed(2)}</td>
                  </tr>
                `
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;
}

// Close modal on background click
document
  .getElementById("detailsModal")
  ?.addEventListener("click", function (e) {
    if (e.target === this) closeDetailsModal();
  });

// Close modal on ESC key
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") {
    closeDetailsModal();
    document.getElementById("manual-order-popup")?.classList.remove("active");
  }
});

// Add console message
console.log("✅ Employee Dashboard initialized successfully");
console.log("✅ Status dropdown functionality loaded");
console.log("✅ Manual order functionality loaded");
console.log(
  "ℹ️  Include empolyee.js for additional features (dashboard data, customer tracking, etc.)"
);

// The following code for searching customer by email
// // 🔍 Search customer by email and view their info + orders
// document.addEventListener("DOMContentLoaded", () => {
//   const searchBtn = document.getElementById("btn-track-email");
//   const emailInput = document.getElementById("tracking-email");
//   const resultsDiv = document.getElementById("email-search-results");
//   const manualBtn = document.getElementById("fetch-customer"); // existing manual order button
//   const manualInput = document.getElementById("manual-user-id");

//   searchBtn.addEventListener("click", async () => {
//     const email = emailInput.value.trim();
//     if (!email) {
//       resultsDiv.innerHTML = `<p style="color:red;">⚠️ Please enter an email address.</p>`;
//       return;
//     }

//     resultsDiv.innerHTML = `<p>🔎 Searching...</p>`;

//     try {
//       const res = await fetch(
//         `/api/customers/email/${encodeURIComponent(email)}`
//       );
//       const data = await res.json();

//       if (!data.success) {
//         resultsDiv.innerHTML = `<p style="color:red;">❌ ${data.message}</p>`;
//         return;
//       }

//       const c = data.customer;
//       const orders = data.orders;

//       let ordersHTML = orders.length
//         ? `
//         <table style="width:100%;border-collapse:collapse;margin-top:1rem;">
//           <thead>
//             <tr style="background:#222;color:#fff;">
//               <th style="padding:8px;border:1px solid #444;">Order ID</th>
//               <th style="padding:8px;border:1px solid #444;">Total</th>
//               <th style="padding:8px;border:1px solid #444;">Shipping</th>
//               <th style="padding:8px;border:1px solid #444;">Date</th>
//               <th style="padding:8px;border:1px solid #444;">Status</th>
//               <th style="padding:8px;border:1px solid #444;">Actions</th>
//             </tr>
//           </thead>
//           <tbody>
//             ${orders
//               .map(
//                 (o) => `
//               <tr style="text-align:center;background:#fff;">
//                 <td style="padding:6px;border:1px solid #ccc;">${
//                   o.order_id
//                 }</td>
//                 <td style="padding:6px;border:1px solid #ccc;">$${
//                   o.total_amount
//                 }</td>
//                 <td style="padding:6px;border:1px solid #ccc;">$${
//                   o.shipping
//                 }</td>
//                 <td style="padding:6px;border:1px solid #ccc;">${new Date(
//                   o.created_at
//                 ).toLocaleDateString()}</td>
//                 <td style="padding:6px;border:1px solid #ccc;">${
//                   o.payment_status || "N/A"
//                 }</td>
//                 <td style="padding:6px;border:1px solid #ccc;">
//                   <button class="view-items" data-id="${
//                     o.order_id
//                   }" style="padding:4px 8px;background:#007bff;color:white;border:none;border-radius:4px;cursor:pointer;">View Items</button>
//                 </td>
//               </tr>
//               <tr id="items-${
//                 o.order_id
//               }" style="display:none;background:#f9f9f9;">
//                 <td colspan="6" style="padding:10px;">
//                   <div class="items-container">Loading...</div>
//                 </td>
//               </tr>`
//               )
//               .join("")}
//           </tbody>
//         </table>`
//         : "<p>No orders found for this customer.</p>";

//       resultsDiv.innerHTML = `
//         <div style="background:#f8f8f8;padding:1rem;border-radius:8px;">
//           <h3>Customer Info</h3>
//           <p><strong>Name:</strong> ${c.first_name} ${c.last_name}</p>
//           <p><strong>Email:</strong> ${c.email}</p>
//           <p><strong>Phone:</strong> ${c.phone || "-"}</p>
//           <p><strong>Address:</strong> ${c.street_address}, ${c.city}, ${
//         c.state
//       }, ${c.zip_code}</p>
//           <button id="manual-order-email" style="margin-top:10px;background:#28a745;color:white;padding:6px 10px;border:none;border-radius:4px;cursor:pointer;">
//             <i class="fas fa-plus-circle"></i> Manual Order
//           </button>
//           <h3 style="margin-top:1rem;">Orders</h3>
//           ${ordersHTML}
//         </div>`;

//       // 🟢 Add manual order button click (auto-fill customer)
//       document
//         .getElementById("manual-order-email")
//         .addEventListener("click", () => {
//           manualInput.value = c.id; // auto-fill user ID
//           manualBtn.click(); // trigger existing manual order popup
//           document
//             .querySelector("#manual-order-popup")
//             .scrollIntoView({ behavior: "smooth" });
//         });

//       // 🟢 Add order item toggle functionality
//       document.querySelectorAll(".view-items").forEach((btn) => {
//         btn.addEventListener("click", async () => {
//           const orderId = btn.dataset.id;
//           const row = document.getElementById(`items-${orderId}`);
//           const container = row.querySelector(".items-container");

//           if (row.style.display === "none") {
//             row.style.display = "table-row";

//             try {
//               const itemRes = await fetch(`/api/order-items_email/${orderId}`);
//               const itemData = await itemRes.json();

//               if (itemData.success && itemData.items.length > 0) {
//                 container.innerHTML = `
//                   <table style="width:100%;border-collapse:collapse;">
//                     <thead>
//                       <tr style="background:#eee;">
//                         <th style="padding:5px;border:1px solid #ccc;">Name</th>
//                         <th style="padding:5px;border:1px solid #ccc;">MG</th>
//                         <th style="padding:5px;border:1px solid #ccc;">Qty</th>
//                         <th style="padding:5px;border:1px solid #ccc;">Price</th>
//                       </tr>
//                     </thead>
//                     <tbody>
//                       ${itemData.items
//                         .map(
//                           (i) => `
//                         <tr>
//                           <td style="padding:5px;border:1px solid #ccc;">${i.name}</td>
//                           <td style="padding:5px;border:1px solid #ccc;">${i.mg}</td>
//                           <td style="padding:5px;border:1px solid #ccc;">${i.quantity}</td>
//                           <td style="padding:5px;border:1px solid #ccc;">$${i.price}</td>
//                         </tr>`
//                         )
//                         .join("")}
//                     </tbody>
//                   </table>`;
//               } else {
//                 container.innerHTML = "<p>No items found for this order.</p>";
//               }
//             } catch (err) {
//               container.innerHTML =
//                 "<p style='color:red;'>Error fetching items.</p>";
//             }
//           } else {
//             row.style.display = "none";
//           }
//         });
//       });
//     } catch (err) {
//       console.error("Error fetching customer by email:", err);
//       resultsDiv.innerHTML = `<p style="color:red;">⚠️ Failed to fetch data.</p>`;
//     }
//   });
// });
