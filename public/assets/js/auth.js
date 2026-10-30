/* auth.js - shared logic for login.html and register.html (plain JS, no libraries) */
(function () {
  "use strict";

  var EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  // ---------- API ----------
  function post(path, body) {
    return fetch("/api/account" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { status: res.status, data: data };
      });
    }).catch(function () {
      return { status: 0, data: { success: false, message: "Can't reach the server. Check your connection and try again." } };
    });
  }

  // ---------- Helpers ----------
  // Only allow redirects to paths on this site (blocks open-redirect tricks)
  function safeNext() {
    var n = new URLSearchParams(location.search).get("next") || "/";
    if (n.charAt(0) !== "/" || n.charAt(1) === "/" || n.charAt(1) === "\\" || /^\/(login|register)\b/.test(n)) return "/";
    return n;
  }
  function goNext() { location.replace(safeNext()); }

  function setBusy(btn, on) { btn.disabled = on; btn.classList.toggle("is-loading", on); }

  function showAlert(box, msg, type) {
    box.className = "alert alert--" + (type || "error");
    box.textContent = msg;
    box.hidden = false;
  }
  function hideAlert(box) { box.hidden = true; box.textContent = ""; }

  function setFieldError(input, msg, link) {
    var field = input.closest(".field");
    var el = $(".field-error", field);
    if (!msg) {
      input.classList.remove("is-invalid");
      input.removeAttribute("aria-invalid");
      if (el) el.remove();
      return;
    }
    input.classList.add("is-invalid");
    input.setAttribute("aria-invalid", "true");
    if (!el) {
      el = document.createElement("div");
      el.className = "field-error";
      el.setAttribute("role", "alert");
      field.appendChild(el);
    }
    el.textContent = msg;
    if (link) {
      el.appendChild(document.createTextNode(" "));
      var a = document.createElement("a");
      a.href = link.href; a.textContent = link.text;
      el.appendChild(a);
    }
  }

  // Same rules as the server
  function isEmail(v) { return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }
  function isPhone(v) { return /^\+?\d{7,15}$/.test(v.replace(/[\s\-().]/g, "")); }
  function pwBytes(v) { return new TextEncoder().encode(v).length; }

  function bindPasswordToggles() {
    $$("[data-toggle-pw]").forEach(function (btn) {
      btn.innerHTML = EYE;
      btn.addEventListener("click", function () {
        var input = btn.parentElement.querySelector("input");
        var show = input.type === "password";
        input.type = show ? "text" : "password";
        btn.innerHTML = show ? EYE_OFF : EYE;
        btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
        btn.setAttribute("aria-pressed", String(show));
      });
    });
  }

  function bindClearOnType(form) {
    form.addEventListener("input", function (e) {
      if (e.target.classList && e.target.classList.contains("input")) setFieldError(e.target, null);
    });
  }

  function keepNextOnLinks() {
    var n = safeNext();
    if (n === "/") return;
    $$("a[data-keep-next]").forEach(function (a) {
      a.href += (a.href.indexOf("?") > -1 ? "&" : "?") + "next=" + encodeURIComponent(n);
    });
  }

  // If already signed in, skip the page
  function redirectIfSignedIn() {
    fetch("/api/account/me", { credentials: "same-origin" })
      .then(function (r) { return r.json(); })
      .then(function (d) { if (d && d.loggedIn) goNext(); })
      .catch(function () {});
  }

  // ---------- Password strength (guidance only; the server enforces the real rules) ----------
  function strengthLevel(pw) {
    if (!pw) return { level: 0, label: "" };
    if (pw.length < 8) return { level: 1, label: "Too short (minimum 8 characters)" };
    var classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(function (r) { return r.test(pw); }).length;
    var level = classes >= 3 ? 3 : classes === 2 ? 2 : 1;
    if (pw.length >= 12) level = Math.min(4, level + 1);
    return { level: level, label: ["", "Weak", "Fair", "Good", "Strong"][level] };
  }

  // ---------- OTP component ----------
  function mountOtp(container, opts) {
    var boxesHtml = "";
    for (var i = 0; i < 6; i++) {
      boxesHtml += '<input class="otp-box" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="' +
        (i === 0 ? "one-time-code" : "off") + '" aria-label="Digit ' + (i + 1) + '">';
    }
    container.innerHTML =
      '<h1>Verify your <span class="gradient-text">email</span></h1>' +
      '<p class="auth-sub" data-sub></p>' +
      '<div class="alert" data-alert role="alert" hidden></div>' +
      '<div class="otp-boxes" role="group" aria-label="6-digit verification code">' + boxesHtml + '</div>' +
      '<button class="btn" type="button" data-submit>Verify &amp; continue</button>' +
      '<div class="otp-foot"><span>Didn\'t get it? <button class="link-btn" type="button" data-resend disabled>Resend code</button></span>' +
      '<button class="link-btn" type="button" data-back></button></div>';

    var sub = $("[data-sub]", container), alertBox = $("[data-alert]", container);
    var wrap = $(".otp-boxes", container), boxes = $$(".otp-box", container);
    var submitBtn = $("[data-submit]", container), resendBtn = $("[data-resend]", container);
    var backBtn = $("[data-back]", container);
    var email = "", busy = false, timer = null;
    backBtn.textContent = opts.backLabel;

    function code() { return boxes.map(function (b) { return b.value; }).join(""); }
    function paint() { boxes.forEach(function (b) { b.classList.toggle("is-filled", b.value !== ""); }); }
    function clearBoxes() { boxes.forEach(function (b) { b.value = ""; }); paint(); }
    function fill(start, digits) {
      for (var k = 0; k < digits.length && start + k < 6; k++) boxes[start + k].value = digits.charAt(k);
      paint();
      var next = Math.min(start + digits.length, 5);
      boxes[next].focus();
      if (code().length === 6) submit();
    }

    boxes.forEach(function (box, i) {
      box.addEventListener("focus", function () { box.select(); });
      box.addEventListener("input", function () {
        var d = box.value.replace(/\D/g, "");
        if (!d) { box.value = ""; paint(); return; }
        if (d.length === 1) { box.value = d; fill(i, d); return; }
        if (d.length === 2) { box.value = ""; fill(i, d.charAt(1)); return; } // typed over a filled box
        box.value = ""; fill(i === 0 ? 0 : i, d);                              // autofill / long input
      });
      box.addEventListener("keydown", function (e) {
        if (e.key === "Backspace" && !box.value && i > 0) { e.preventDefault(); boxes[i - 1].value = ""; paint(); boxes[i - 1].focus(); }
        else if (e.key === "ArrowLeft" && i > 0) { e.preventDefault(); boxes[i - 1].focus(); }
        else if (e.key === "ArrowRight" && i < 5) { e.preventDefault(); boxes[i + 1].focus(); }
        else if (e.key === "Enter") { e.preventDefault(); submit(); }
      });
      box.addEventListener("paste", function (e) {
        e.preventDefault();
        var d = ((e.clipboardData || window.clipboardData).getData("text") || "").replace(/\D/g, "").slice(0, 6);
        if (d) fill(d.length === 6 ? 0 : i, d);
      });
    });

    function startTimer(sec) {
      clearInterval(timer);
      var left = sec;
      resendBtn.disabled = true;
      resendBtn.textContent = "Resend code in " + left + "s";
      timer = setInterval(function () {
        left--;
        if (left <= 0) { clearInterval(timer); resendBtn.disabled = false; resendBtn.textContent = "Resend code"; }
        else resendBtn.textContent = "Resend code in " + left + "s";
      }, 1000);
    }

    function submit() {
      if (busy) return;
      if (code().length !== 6) { showAlert(alertBox, "Enter the 6-digit code from your email."); return; }
      busy = true; setBusy(submitBtn, true); hideAlert(alertBox);
      post("/verify-otp", { email: email, otp: code() }).then(function (r) {
        busy = false; setBusy(submitBtn, false);
        if (r.data && r.data.success) { opts.onVerified(r.data.user); return; }
        showAlert(alertBox, (r.data && r.data.message) || "Verification failed. Please try again.");
        wrap.classList.add("is-error");
        setTimeout(function () { wrap.classList.remove("is-error"); }, 400);
        clearBoxes(); boxes[0].focus();
      });
    }

    submitBtn.addEventListener("click", submit);
    backBtn.addEventListener("click", function () { api.hide(); opts.onBack(); });
    resendBtn.addEventListener("click", function () {
      resendBtn.disabled = true;
      post("/resend-otp", { email: email }).then(function (r) {
        if (r.data && r.data.success) { showAlert(alertBox, "A new code is on its way. Check your inbox.", "info"); clearBoxes(); boxes[0].focus(); startTimer(60); }
        else { showAlert(alertBox, (r.data && r.data.message) || "Couldn't resend the code."); startTimer(r.status === 429 ? 60 : 10); }
      });
    });

    var api = {
      show: function (addr, prefix) {
        email = addr;
        sub.textContent = prefix || "We sent a 6-digit code to ";
        var s = document.createElement("strong"); s.textContent = addr;
        sub.appendChild(s);
        sub.appendChild(document.createTextNode(". It expires in 10 minutes. Check your spam folder if you don't see it."));
        hideAlert(alertBox); clearBoxes();
        container.hidden = false;
        startTimer(60);
        boxes[0].focus();
      },
      hide: function () { clearInterval(timer); container.hidden = true; }
    };
    return api;
  }

  // ---------- Register page ----------
  function initRegister() {
    var form = $("#register-form"), step1 = $("#step-form"), alertBox = $("#form-alert");
    var email = $("#email"), phone = $("#phone"), pw = $("#password"), pw2 = $("#confirm");
    var btn = $("#register-btn"), meter = $("#strength"), meterLabel = $("#strength-label");

    var otp = mountOtp($("#step-otp"), {
      backLabel: "\u2190 Use a different email",
      onVerified: goNext,
      onBack: function () { step1.hidden = false; email.focus(); }
    });

    pw.addEventListener("input", function () {
      var s = strengthLevel(pw.value);
      meter.setAttribute("data-level", String(s.level));
      meterLabel.textContent = s.label;
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      hideAlert(alertBox);
      var ev = email.value.trim().toLowerCase(), errors = [];
      if (!isEmail(ev)) errors.push([email, "Enter a valid email address."]);
      if (!isPhone(phone.value)) errors.push([phone, "Enter a valid phone number (7\u201315 digits, e.g. +1 209 593 7171)."]);
      if (pw.value.length < 8) errors.push([pw, "Password must be at least 8 characters."]);
      else if (pwBytes(pw.value) > 72) errors.push([pw, "Password is too long (maximum 72 characters)."]);
      if (pw2.value !== pw.value) errors.push([pw2, "Passwords don't match."]);
      [email, phone, pw, pw2].forEach(function (i) { setFieldError(i, null); });
      if (errors.length) {
        errors.forEach(function (x) { setFieldError(x[0], x[1]); });
        errors[0][0].focus();
        return;
      }

      setBusy(btn, true);
      post("/register", { email: ev, phone: phone.value, password: pw.value }).then(function (r) {
        setBusy(btn, false);
        var d = r.data || {};
        if (d.success) { step1.hidden = true; otp.show(d.email || ev); return; }
        if (d.code === "EMAIL_EXISTS") {
          var n = safeNext();
          setFieldError(email, "An account with this email already exists.", {
            href: "/login?email=" + encodeURIComponent(ev) + (n !== "/" ? "&next=" + encodeURIComponent(n) : ""),
            text: "Sign in instead"
          });
          email.focus();
          return;
        }
        var target = { email: email, phone: phone, password: pw }[d.field];
        if (target) { setFieldError(target, d.message); target.focus(); }
        else showAlert(alertBox, d.message || "Something went wrong. Please try again.");
      });
    });

    bindClearOnType(form);
  }

  // ---------- Login page ----------
  function initLogin() {
    var form = $("#login-form"), step1 = $("#step-form"), alertBox = $("#form-alert");
    var email = $("#email"), pw = $("#password"), btn = $("#login-btn");

    var otp = mountOtp($("#step-otp"), {
      backLabel: "\u2190 Back to sign in",
      onVerified: goNext,
      onBack: function () { step1.hidden = false; pw.value = ""; pw.focus(); }
    });

    var pre = new URLSearchParams(location.search).get("email");
    if (pre) { email.value = pre; pw.focus(); } else { email.focus(); }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      hideAlert(alertBox);
      var ev = email.value.trim().toLowerCase();
      setFieldError(email, null); setFieldError(pw, null);
      if (!isEmail(ev)) { setFieldError(email, "Enter a valid email address."); email.focus(); return; }
      if (!pw.value) { setFieldError(pw, "Enter your password."); pw.focus(); return; }

      setBusy(btn, true);
      post("/login", { email: ev, password: pw.value }).then(function (r) {
        setBusy(btn, false);
        var d = r.data || {};
        if (d.success) { goNext(); return; }
        if (d.code === "NOT_VERIFIED") {
          step1.hidden = true;
          otp.show(d.email || ev, "Your email isn\u2019t verified yet. We sent a new 6-digit code to ");
          return;
        }
        showAlert(alertBox, d.message || "Something went wrong. Please try again.");
        if (r.status === 401) { pw.value = ""; pw.focus(); }
      });
    });

    bindClearOnType(form);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var page = document.body.getAttribute("data-page");
    if (!page) return;
    bindPasswordToggles();
    keepNextOnLinks();
    redirectIfSignedIn();
    if (page === "register") initRegister();
    if (page === "login") initLogin();
  });
})();