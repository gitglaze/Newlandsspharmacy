async function loadCartCount() {
  var badge =document.getElementById("cartn");
  if (!badge) return;
  
  try {
    var response = await fetch("/api/cart/count", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    
    if (!response.ok) {
      throw new Error("Cart count request failed (" + response.status + ")");
    }
    
    var data = await response.json();
    if (data && data.success) {
      badge.textContent = String(Number(data.count) || 0);
    }
  } catch (error) {
    console.error("Unable to load cart count:", error);
    // Leave the badge at its existing value; do not show a fake count.
  }
}

loadCartCount();
