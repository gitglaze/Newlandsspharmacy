// account.js
// Customer accounts: register -> email OTP verification -> login / logout -> my orders.
//
// SAFE BY DESIGN: it creates its own 3 tables (user_accounts, account_otps,
// account_sessions) and never alters customers / orders / order_items.
// Orders are connected by the VERIFIED account email (read-only SELECTs).
//
// Mounted in server.js with ONE line:
//   app.use("/api/account", require("./account")(pool));

const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcrypt");
const nodemailer = require("nodemailer");

// ---------- Settings ----------
const COOKIE_NAME = "acct_session";
const SESSION_DAYS = 30;
const OTP_TTL_MIN = 10; // code valid for 10 minutes
const OTP_MAX_ATTEMPTS = 5; // wrong guesses allowed per code
const OTP_COOLDOWN_SEC = 60; // minimum gap between two emails
const BCRYPT_ROUNDS = 12;

// Email account. Better: put MAIL_USER / MAIL_PASS (and MAIL_HOST) in .env
const BRAND = "Newlandss Pharmacy";
const MAIL_HOST = process.env.MAIL_HOST ;
const MAIL_USER = process.env.MAIL_USER ;
const MAIL_PASS = process.env.MAIL_PASS ;

// ---------- Helpers ----------
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const hashOtp = (userId, otp) =>
  crypto
    .createHmac("sha256", String(process.env.JWT_SECRET || "change-me"))
    .update(`${userId}:${otp}`)
    .digest("hex");

const normEmail = (v) => String(v || "").trim().toLowerCase();
const normPhone = (v) => String(v || "").replace(/[\s\-().]/g, "");
const isEmail = (v) => v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const isPhone = (v) => /^\+?\d{7,15}$/.test(v);
// bcrypt only uses the first 72 bytes, so we cap there
const isPassword = (v) =>
  typeof v === "string" && v.length >= 8 && Buffer.byteLength(v) <= 72;

const clientIp = (req) =>
  (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
  req.socket.remoteAddress ||
  "unknown";

// Tiny in-memory rate limiter (same idea as your VPN rate limiter)
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const rec = hits.get(key);
  if (!rec || now > rec.reset) {
    hits.set(key, { count: 1, reset: now + windowMs });
    return false;
  }
  rec.count++;
  return rec.count > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (now > v.reset) hits.delete(k);
}, 10 * 60 * 1000).unref();

// Used so "unknown email" and "wrong password" take the same time
const DUMMY_HASH = bcrypt.hashSync(
  crypto.randomBytes(8).toString("hex"),
  BCRYPT_ROUNDS
);

const mailer = nodemailer.createTransport({
  host: MAIL_HOST,
  port: 465,
  secure: true,
  auth: { user: MAIL_USER, pass: MAIL_PASS },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 15000,
});

function otpEmailHtml(otp) {
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
<table width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f4;padding:20px 0;"><tr><td align="center">
<table width="480" cellspacing="0" cellpadding="0" style="background:#fff;border-radius:8px;overflow:hidden;">
<tr><td align="center" style="background:#0066CC;padding:20px;color:#fff;font-size:22px;font-weight:bold;">${BRAND}</td></tr>
<tr><td style="padding:28px 30px;color:#333;font-size:15px;line-height:22px;">
<p style="margin:0 0 12px;">Use this code to verify your email address:</p>
<p style="margin:18px 0;text-align:center;font-size:34px;letter-spacing:8px;font-weight:bold;color:#0066CC;">${otp}</p>
<p style="margin:0 0 12px;">This code expires in ${OTP_TTL_MIN} minutes. Never share it with anyone.</p>
<p style="margin:0;color:#777;font-size:13px;">If you didn't create an account, you can safely ignore this email.</p>
</td></tr>
<tr><td align="center" style="background:#fafafa;padding:14px;color:#777;font-size:12px;">&copy; ${new Date().getFullYear()} ${BRAND}. All rights reserved.</td></tr>
</table></td></tr></table></body></html>`;
}

// ---------- Module ----------
module.exports = function (pool) {
  const router = express.Router();

  // ----- Create our own tables (safe to run on every start) -----
  async function ensureTables() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_accounts (
        id            SERIAL PRIMARY KEY,
        email         VARCHAR(254) NOT NULL UNIQUE,
        phone         VARCHAR(20)  NOT NULL,
        password_hash TEXT         NOT NULL,
        is_verified   BOOLEAN      NOT NULL DEFAULT FALSE,
        created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS account_otps (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER     NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
        purpose    VARCHAR(20) NOT NULL DEFAULT 'register',
        otp_hash   VARCHAR(64) NOT NULL,
        attempts   INTEGER     NOT NULL DEFAULT 0,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_account_otps_user ON account_otps(user_id, purpose);
      CREATE TABLE IF NOT EXISTS account_sessions (
        id         SERIAL PRIMARY KEY,
        user_id    INTEGER     NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log("✅ Account tables ready");
  }
  const ready = ensureTables()
    .then(() => true)
    .catch((err) => {
      console.error("❌ Account tables setup failed:", err.message);
      return false;
    });

  // Hourly cleanup of expired sessions / codes
  setInterval(() => {
    pool
      .query(
        `DELETE FROM account_sessions WHERE expires_at < NOW();
         DELETE FROM account_otps WHERE expires_at < NOW() - INTERVAL '1 day';`
      )
      .catch(() => {});
  }, 60 * 60 * 1000).unref();

  router.use(async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (await ready) return next();
    res.status(503).json({ success: false, message: "Account service unavailable" });
  });

  const wrap = (fn) => (req, res) =>
    fn(req, res).catch((err) => {
      console.error("Account error:", err);
      if (!res.headersSent)
        res.status(500).json({ success: false, message: "Something went wrong. Please try again." });
    });

  // ----- OTP -----
  // Returns { sent: true } or { sent: false, wait: seconds }. Throws if email fails.
  async function sendOtp(user, purpose = "register") {
    const cd = await pool.query(
      `SELECT CEIL(EXTRACT(EPOCH FROM (created_at + make_interval(secs => $3) - NOW()))) AS wait
         FROM account_otps
        WHERE user_id = $1 AND purpose = $2
          AND created_at > NOW() - make_interval(secs => $3)`,
      [user.id, purpose, OTP_COOLDOWN_SEC]
    );
    if (cd.rows.length) return { sent: false, wait: Number(cd.rows[0].wait) };

    const otp = String(crypto.randomInt(100000, 1000000));
    await pool.query(`DELETE FROM account_otps WHERE user_id = $1 AND purpose = $2`, [user.id, purpose]);
    const ins = await pool.query(
      `INSERT INTO account_otps (user_id, purpose, otp_hash, expires_at)
       VALUES ($1, $2, $3, NOW() + make_interval(mins => $4)) RETURNING id`,
      [user.id, purpose, hashOtp(user.id, otp), OTP_TTL_MIN]
    );
    try {
      await mailer.sendMail({
        from: `"${BRAND}" <${MAIL_USER}>`,
        to: user.email,
        subject: `${otp} is your ${BRAND} verification code`,
        html: otpEmailHtml(otp),
      });
    } catch (err) {
      // remove the code so the user can retry immediately
      await pool.query(`DELETE FROM account_otps WHERE id = $1`, [ins.rows[0].id]);
      throw err;
    }
    return { sent: true };
  }

  // ----- Sessions (random token in httpOnly cookie, only its hash is stored) -----
  const cookieOpts = () => ({
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  async function startSession(res, userId) {
    const token = crypto.randomBytes(32).toString("hex");
    await pool.query(
      `INSERT INTO account_sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() + make_interval(days => $3))`,
      [userId, sha256(token), SESSION_DAYS]
    );
    res.cookie(COOKIE_NAME, token, { ...cookieOpts(), maxAge: SESSION_DAYS * 86400000 });
  }

  async function getAccount(req) {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    if (typeof token !== "string" || token.length !== 64) return null;
    const r = await pool.query(
      `SELECT u.id, u.email, u.phone
         FROM account_sessions s JOIN user_accounts u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.is_verified = TRUE`,
      [sha256(token)]
    );
    return r.rows[0] || null;
  }

  // Reusable guard: app.get("/x", accountRouter.requireAccount, handler)
  router.requireAccount = async (req, res, next) => {
    try {
      req.account = await getAccount(req);
      if (!req.account)
        return res.status(401).json({ success: false, message: "Please sign in." });
      next();
    } catch (err) {
      console.error("Account auth error:", err);
      res.status(500).json({ success: false, message: "Server error" });
    }
  };

  // =====================================================
  // POST /api/account/register   { email, phone, password }
  // =====================================================
  router.post("/register", wrap(async (req, res) => {
    const b = req.body || {};
    const email = normEmail(b.email);
    const phone = normPhone(b.phone);
    const password = b.password;

    if (!isEmail(email))
      return res.status(400).json({ success: false, field: "email", message: "Enter a valid email address." });
    if (!isPhone(phone))
      return res.status(400).json({ success: false, field: "phone", message: "Enter a valid phone number (7-15 digits, country code optional)." });
    if (!isPassword(password))
      return res.status(400).json({ success: false, field: "password", message: "Password must be at least 8 characters." });
    if (limited(`reg:${clientIp(req)}`, 10, 60 * 60 * 1000))
      return res.status(429).json({ success: false, message: "Too many attempts. Please try again later." });

    const existing = (await pool.query(
      `SELECT id, is_verified FROM user_accounts WHERE email = $1`, [email]
    )).rows[0];

    if (existing && existing.is_verified)
      return res.status(409).json({ success: false, code: "EMAIL_EXISTS", field: "email", message: "An account with this email already exists. Please sign in." });

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    let user;
    try {
      if (existing) {
        // Unverified earlier attempt: refresh details (stops anyone squatting an email)
        user = (await pool.query(
          `UPDATE user_accounts SET phone = $2, password_hash = $3 WHERE id = $1
           RETURNING id, email`, [existing.id, phone, passwordHash]
        )).rows[0];
      } else {
        user = (await pool.query(
          `INSERT INTO user_accounts (email, phone, password_hash) VALUES ($1, $2, $3)
           RETURNING id, email`, [email, phone, passwordHash]
        )).rows[0];
      }
    } catch (err) {
      if (err.code === "23505")
        return res.status(409).json({ success: false, code: "EMAIL_EXISTS", field: "email", message: "An account with this email already exists. Please sign in." });
      throw err;
    }

    try {
      await sendOtp(user);
    } catch (err) {
      console.error("OTP email failed:", err.message);
      return res.status(502).json({ success: false, message: "We couldn't send the verification email. Please check the address and try again." });
    }
    res.json({ success: true, email: user.email, message: "Verification code sent to your email." });
  }));

  // =====================================================
  // POST /api/account/verify-otp   { email, otp }   -> signs the user in
  // =====================================================
  router.post("/verify-otp", wrap(async (req, res) => {
    const b = req.body || {};
    const email = normEmail(b.email);
    const otp = String(b.otp || "").trim();

    if (!isEmail(email) || !/^\d{6}$/.test(otp))
      return res.status(400).json({ success: false, message: "Enter the 6-digit code." });
    if (limited(`otp:${clientIp(req)}`, 30, 15 * 60 * 1000))
      return res.status(429).json({ success: false, message: "Too many attempts. Please try again later." });

    const user = (await pool.query(
      `SELECT id, email, phone, is_verified FROM user_accounts WHERE email = $1`, [email]
    )).rows[0];
    if (!user)
      return res.status(400).json({ success: false, message: "Invalid or expired code." });
    if (user.is_verified)
      return res.status(400).json({ success: false, message: "This email is already verified. Please sign in." });

    // Atomically use up one attempt (safe even if guesses arrive in parallel)
    const row = (await pool.query(
      `UPDATE account_otps SET attempts = attempts + 1
        WHERE user_id = $1 AND purpose = 'register'
          AND expires_at > NOW() AND attempts < $2
        RETURNING otp_hash, attempts`,
      [user.id, OTP_MAX_ATTEMPTS]
    )).rows[0];
    if (!row)
      return res.status(400).json({ success: false, code: "OTP_EXPIRED", message: "This code has expired or has too many wrong attempts. Please request a new one." });

    const a = Buffer.from(hashOtp(user.id, otp));
    const c = Buffer.from(row.otp_hash);
    if (a.length !== c.length || !crypto.timingSafeEqual(a, c)) {
      const left = OTP_MAX_ATTEMPTS - row.attempts;
      return res.status(400).json({ success: false, message: left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many wrong attempts. Please request a new code." });
    }

    await pool.query(`UPDATE user_accounts SET is_verified = TRUE, last_login_at = NOW() WHERE id = $1`, [user.id]);
    await pool.query(`DELETE FROM account_otps WHERE user_id = $1`, [user.id]);
    await startSession(res, user.id);
    res.json({ success: true, user: { id: user.id, email: user.email, phone: user.phone } });
  }));

  // =====================================================
  // POST /api/account/resend-otp   { email }
  // (same answer whether or not the email exists -> no account probing)
  // =====================================================
  router.post("/resend-otp", wrap(async (req, res) => {
    const email = normEmail((req.body || {}).email);
    if (!isEmail(email))
      return res.status(400).json({ success: false, message: "Enter a valid email address." });
    if (limited(`resend:${clientIp(req)}`, 10, 60 * 60 * 1000))
      return res.status(429).json({ success: false, message: "Too many requests. Please try again later." });

    const user = (await pool.query(
      `SELECT id, email, is_verified FROM user_accounts WHERE email = $1`, [email]
    )).rows[0];
    if (user && !user.is_verified) {
      try { await sendOtp(user); }
      catch (err) {
        console.error("OTP email failed:", err.message);
        return res.status(502).json({ success: false, message: "We couldn't send the email. Please try again." });
      }
    }
    res.json({ success: true, message: "If this email is awaiting verification, a new code has been sent." });
  }));

  // =====================================================
  // POST /api/account/login   { email, password }
  // =====================================================
  router.post("/login", wrap(async (req, res) => {
    const b = req.body || {};
    const email = normEmail(b.email);
    const password = typeof b.password === "string" ? b.password : "";

    if (!isEmail(email) || !password)
      return res.status(400).json({ success: false, message: "Enter your email and password." });
    if (limited(`login-ip:${clientIp(req)}`, 30, 15 * 60 * 1000) || limited(`login:${email}`, 10, 15 * 60 * 1000))
      return res.status(429).json({ success: false, message: "Too many sign-in attempts. Please try again in 15 minutes." });

    const user = (await pool.query(
      `SELECT id, email, phone, password_hash, is_verified FROM user_accounts WHERE email = $1`, [email]
    )).rows[0];

    const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !ok)
      return res.status(401).json({ success: false, message: "Incorrect email or password." });

    if (!user.is_verified) {
      try { await sendOtp(user); } catch (err) { console.error("OTP email failed:", err.message); }
      return res.status(403).json({ success: false, code: "NOT_VERIFIED", email: user.email, message: "Please verify your email. We've sent you a new code." });
    }

    await startSession(res, user.id);
    await pool.query(`UPDATE user_accounts SET last_login_at = NOW() WHERE id = $1`, [user.id]);
    res.json({ success: true, user: { id: user.id, email: user.email, phone: user.phone } });
  }));

  // =====================================================
  // POST /api/account/logout   (deletes the session on the server too)
  // =====================================================
  router.post("/logout", wrap(async (req, res) => {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    if (typeof token === "string" && token.length === 64)
      await pool.query(`DELETE FROM account_sessions WHERE token_hash = $1`, [sha256(token)]);
    res.clearCookie(COOKIE_NAME, cookieOpts());
    res.json({ success: true });
  }));

  // =====================================================
  // GET /api/account/me  -> { loggedIn, user }  (always 200: no console errors for guests)
  // =====================================================
  router.get("/me", wrap(async (req, res) => {
    const user = await getAccount(req);
    res.json(user ? { success: true, loggedIn: true, user } : { success: true, loggedIn: false });
  }));

  // =====================================================
  // GET /api/account/orders  -> this user's orders (+ items), read-only
  // Linked by verified email, so earlier guest checkouts show up too.
  // =====================================================
  router.get("/orders", router.requireAccount, wrap(async (req, res) => {
    const email = req.account.email;
    const orders = (await pool.query(
      `SELECT order_id, total_amount, shipping, created_at, payment_status
         FROM orders
        WHERE LOWER(customer_email) = $1
           OR user_id IN (SELECT id FROM customers WHERE LOWER(email) = $1)
        ORDER BY created_at DESC LIMIT 100`,
      [email]
    )).rows;

    const items = orders.length
      ? (await pool.query(
          `SELECT order_id, name, mg, quantity, price FROM order_items WHERE order_id = ANY($1)`,
          [orders.map((o) => o.order_id)]
        )).rows
      : [];

    res.json({
      success: true,
      orders: orders.map((o) => ({ ...o, items: items.filter((i) => i.order_id === o.order_id) })),
    });
  }));

  return router;
};