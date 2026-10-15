window.$crisp = [];
window.CRISP_WEBSITE_ID = "68987257-808e-403d-a06c-35b3ec18c3ef";
(function () {
  var d = document;
  var s = d.createElement("script");
  s.src = "https://client.crisp.chat/l.js";
  s.async = 1;
  d.getElementsByTagName("head")[0].appendChild(s);
})();

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    if (!response.ok) {
      // 401 or 400 means invalid credentials
      alert("Invalid username or password");
      return;
    }

    const data = await response.json();
    console.log("Login response:", data);

    // Check if we got a token (which indicates successful login)
    if (data.token) {
      // Store the token and user info
      localStorage.setItem("employeeLoggedIn", "true");
      localStorage.setItem("employeeToken", data.token);
      localStorage.setItem("employeeId", data.user.id);
      localStorage.setItem("employeeUsername", data.user.username);

      // Redirect to employee.html
      window.location.href = "employee";
    } else {
      alert("Login failed. Please try again.");
    }
  } catch (err) {
    console.error("Login request failed:", err);
    alert("Server error. Please try again.");
  }
});
