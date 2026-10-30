/* account-nav.js - shows "My Account" (guest) or the account menu with Sign out (signed in). */
(function () {
  "use strict";
  function $(id) { return document.getElementById(id); }

  var guest = $("acctGuest"), user = $("acctUser"), menu = $("acctMenu");
  if (!guest || !user || !menu) return; // markup not on this page
  var avatar = $("acctAvatar"), emailEl = $("acctEmail"), signOutBtn = $("acctSignOut"), errEl = $("acctError");

  // Guest link remembers the current page, so after sign-in they come back here
  var here = location.pathname + location.search;
  if (here !== "/" && here !== "/index.html" && !/^\/(login|register)\b/.test(here)) {
    guest.href = "/login?next=" + encodeURIComponent(here);
  }

  // function closeMenu() { menu.hidden = true; user.setAttribute("aria-expanded", "false"); }
  // function openMenu() { menu.hidden = false; user.setAttribute("aria-expanded", "true"); }

  
function positionMenu() {
  var rect = user.getBoundingClientRect();
  var width = menu.offsetWidth || 280;

  var left = Math.min(
    rect.right - width,
    window.innerWidth - width - 12
  );

  left = Math.max(12, left);

  menu.style.setProperty(
    "--acct-menu-top",
    (rect.bottom + 10) + "px"
  );

  menu.style.setProperty(
    "--acct-menu-left",
    left + "px"
  );
}

function openMenu() {
  menu.hidden = false;
  positionMenu();
  user.setAttribute("aria-expanded", "true");
}

function closeMenu() {
  menu.hidden = true;
  user.setAttribute("aria-expanded", "false");
}

window.addEventListener("resize", function () {
  if (!menu.hidden) positionMenu();
});

window.addEventListener("scroll", function () {
  if (!menu.hidden) positionMenu();
}, true);

  function showGuest() { closeMenu(); user.hidden = true; guest.hidden = false; }
  function showUser(u) {
    avatar.textContent = (u.email || "?").charAt(0);
    emailEl.textContent = u.email;
    errEl.hidden = true;
    signOutBtn.disabled = false;
    guest.hidden = true; user.hidden = false;
  }

  function refresh() {
    fetch("/api/account/me", { credentials: "same-origin", cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.loggedIn && d.user) showUser(d.user); else showGuest(); })
      .catch(showGuest);
  }

  user.addEventListener("click", function (e) { e.stopPropagation(); menu.hidden ? openMenu() : closeMenu(); });
  menu.addEventListener("click", function (e) { e.stopPropagation(); });
  document.addEventListener("click", closeMenu);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !menu.hidden) { closeMenu(); user.focus(); }
  });

  signOutBtn.addEventListener("click", function () {
    signOutBtn.disabled = true; errEl.hidden = true;
    fetch("/api/account/logout", { method: "POST", credentials: "same-origin" })
      .then(function (r) { if (!r.ok) throw new Error("logout failed"); showGuest(); })
      .catch(function () {
        signOutBtn.disabled = false;
        errEl.textContent = "Couldn't sign out. Please try again.";
        errEl.hidden = false;
      });
  });

  // Back/forward button restores the page from cache: re-check the real state
  window.addEventListener("pageshow", function (e) { if (e.persisted) refresh(); });

  refresh();
})();