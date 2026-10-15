// vpn-blocker.js
//
// Self-contained VPN + Country (India) blocking middleware for Express.
//
// HOW IT WORKS (fast -> slow, so almost no requests ever hit a rate-limited API):
//   1. Static assets / the block page / retry route / employee-whitelist form
//      are always allowed through.
//   2. Private/localhost IPs are always allowed (dev machines).
//   3. A remembered employee device (long-lived cookie, set once via
//      /employee-whitelist) -> instant decision, survives future IP changes.
//   4. Manually whitelisted IPs (employees/admins) always pass - no checks, ever.
//   5. If we've already decided about this browser (cookie) -> instant decision.
//   6. If we've already decided about this exact IP (persistent cache) -> instant decision.
//   7. Otherwise check the IP against locally-held CIDR lists (India + known VPN
//      networks). These lists are downloaded from public GitHub-hosted mirrors,
//      refreshed automatically every few days, and checked in-memory with zero
//      network calls - free and effectively unlimited.
//   8. Only if step 7 is inconclusive (residential proxy, unlisted range, IPv6...)
//      do we fall back to the proxycheck.io API, which is rate-limited, so its
//      result is cached (until TTL) and we never ask about that IP again for a while.
//
// Everything decided (blocked or allowed) is written to disk
// (data/ip-cache.json) so restarts don't lose the work, on top of the in-memory
// cache used for speed.
//
// ENV VARS (all optional):
//   PROXYCHECK_API_KEY   - free key from proxycheck.io. Without it you still get
//                           100 free lookups/day (shared per server IP); with a
//                           free key you get 1000/day. The local CIDR lists
//                           absorb the vast majority of traffic, so either is
//                           normally plenty for a small-to-medium storefront.
//   ALLOWED_IPS           - comma-separated list of IPs that always bypass every
//                           check (employees, office, etc). Merged with
//                           data/allowed-ips.json.
//   BLOCK_DATACENTER_IPS  - "true" to also block generic datacenter/hosting IPs
//                           (broader net, small risk of false positives on
//                           corporate NAT gateways). Default: off. VPN-specific
//                           ranges are always blocked regardless of this flag.

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const crypto = require("crypto");

// ============================================================
// 👉 YOUR WHITELISTED IPs — edit this array directly, no other
//    file needs to change. These IPs always bypass every VPN/
//    country check, no exceptions. Restart the server after
//    editing this for it to take effect.
//
//    Example:
//    const MANUALLY_ALLOWED_IPS = [
//      "203.0.113.10",   // my home IP
//      "198.51.100.20",  // office IP
//    ];
//
//    Don't know your IP? Visit https://www.whatismyipaddress.com/
//    from the connection you want to whitelist.
// ============================================================
const MANUALLY_ALLOWED_IPS = [
  // "203.0.113.10",
  "42.104.0.0/16",
  "123.253.236.2",
  "123.253.0.0/16",
  "152.58.45.190",
  "152.58.0.0/16",
  "49.36.0.0/16",
];

// ============================================================
// CONFIG
// ============================================================
const DATA_DIR = path.join(__dirname, "data");
const LISTS_DIR = path.join(DATA_DIR, "lists");
const ALLOWED_IPS_FILE = path.join(DATA_DIR, "allowed-ips.json");
const EMPLOYEE_TOKENS_FILE = path.join(DATA_DIR, "employee-tokens.json");
const IP_CACHE_FILE = path.join(DATA_DIR, "ip-cache.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const LIST_URLS = {
  india: "https://raw.githubusercontent.com/ipverse/rir-ip/master/country/in/ipv4-aggregated.txt",
  vpn: "https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/vpn/ipv4.txt",
  datacenter: "https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/datacenter/ipv4.txt",
};

const BLOCK_DATACENTER_IPS = process.env.BLOCK_DATACENTER_IPS === "true";
const LIST_REFRESH_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000; // refresh CIDR lists every 3 days
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h for confirmed allow/block verdicts
const CACHE_TTL_ON_ERROR_MS = 30 * 60 * 1000; // short TTL when we fail-open due to an error
const MAX_CACHE_ENTRIES = 50000; // LRU cap so memory/disk can't grow unbounded
const SAVE_DEBOUNCE_MS = 5000;

const PROXYCHECK_API_KEY = process.env.PROXYCHECK_API_KEY || "";
const PROXYCHECK_TIMEOUT_MS = 4000;
const MAX_API_CALLS_PER_DAY = PROXYCHECK_API_KEY ? 900 : 90; // margin under the 1000/100 free limits

const STATIC_EXT_RE =
  /\.(css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|avif|bmp|woff2?|ttf|eot|otf|mp4|webm|txt|xml|json|pdf)$/i;
const ALWAYS_ALLOW_PATHS = new Set(["/restricted.html", "/retry"]);

// ============================================================
// SETUP DIRS
// ============================================================
for (const dir of [DATA_DIR, LISTS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ============================================================
// IP <-> INTEGER HELPERS + CIDR RANGE TABLES
// ============================================================
function ipToLong(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) + v;
  }
  return n >>> 0;
}

function ipMatchesCidr(ip, cidr) {
  const [networkIp, prefixStr] = cidr.split("/");
  const prefix = Number(prefixStr);

  const ipLong = ipToLong(ip);
  const networkLong = ipToLong(networkIp);

  if (
    ipLong === null ||
    networkLong === null ||
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > 32
  ) {
    return false;
  }

  const mask = prefix === 0
    ? 0
    : (0xffffffff << (32 - prefix)) >>> 0;

  return (ipLong & mask) === (networkLong & mask);
}

function parseCidrLine(line) {
  line = line.trim();
  if (!line || line.startsWith("#")) return null;
  const [ipPart, prefixPart] = line.split("/");
  const ipLong = ipToLong(ipPart);
  if (ipLong === null) return null;
  const prefix = prefixPart === undefined ? 32 : parseInt(prefixPart, 10);
  if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const start = (ipLong & mask) >>> 0;
  const end = (start | (~mask >>> 0)) >>> 0;
  return [start, end];
}

// Builds a sorted, merged, disjoint range table from raw CIDR text so lookups
// can use a simple binary search.
function buildRangeTable(rawText) {
  const ranges = [];
  for (const line of rawText.split("\n")) {
    const r = parseCidrLine(line);
    if (r) ranges.push(r);
  }
  ranges.sort((a, b) => a[0] - b[0]);

  const merged = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1] + 1) {
      if (end > last[1]) last[1] = end;
    } else {
      merged.push([start, end]);
    }
  }

  const starts = new Uint32Array(merged.length);
  const ends = new Uint32Array(merged.length);
  merged.forEach(([s, e], i) => {
    starts[i] = s;
    ends[i] = e;
  });
  return { starts, ends };
}

function ipInTable(ipLong, table) {
  if (!table || table.starts.length === 0) return false;
  let lo = 0,
    hi = table.starts.length - 1,
    ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (table.starts[mid] <= ipLong) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (ans === -1) return false;
  return ipLong <= table.ends[ans];
}

// ============================================================
// CIDR LIST LOADING / AUTO-REFRESH (India + VPN + Datacenter)
// ============================================================
const tables = { india: null, vpn: null, datacenter: null };

async function refreshList(name, url) {
  const file = path.join(LISTS_DIR, `${name}.txt`);
  try {
    const res = await axios.get(url, {
      timeout: 20000,
      headers: { "User-Agent": "vpn-blocker/1.0" },
    });
    fs.writeFileSync(file, res.data);
    tables[name] = buildRangeTable(res.data);
    console.log(`IP list refreshed: ${name} (${tables[name].starts.length} ranges)`);
    return true;
  } catch (err) {
    console.error(`Failed to download ${name} list: ${err.message}`);
    // Fall back to whatever we last saved to disk, if anything.
    if (!tables[name] && fs.existsSync(file)) {
      try {
        tables[name] = buildRangeTable(fs.readFileSync(file, "utf8"));
        console.log(`Using cached-on-disk ${name} list (${tables[name].starts.length} ranges)`);
      } catch (readErr) {
        console.error(`Could not read cached ${name} list either: ${readErr.message}`);
      }
    }
    return false;
  }
}

async function refreshAllLists() {
  await Promise.all([
    refreshList("india", LIST_URLS.india),
    refreshList("vpn", LIST_URLS.vpn),
    BLOCK_DATACENTER_IPS ? refreshList("datacenter", LIST_URLS.datacenter) : Promise.resolve(),
  ]);
}

// Kick off an initial load immediately (don't block server startup on it -
// until it resolves, local-list checks simply miss and fall through to the
// API layer, which fails open on error anyway).
refreshAllLists();
setInterval(refreshAllLists, LIST_REFRESH_INTERVAL_MS);

// ============================================================
// PERSISTENT STORES: employee/manual allow-list + auto-decision cache
// ============================================================
function loadJson(file, fallback) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.error(`Could not read ${file}: ${err.message}`);
  }
  return fallback;
}

// ---- Manual allow-list (permanent, never expires, never re-checked) ----
// Merges three sources, in this order: the MANUALLY_ALLOWED_IPS array at the
// top of this file, the ALLOWED_IPS env var, and data/allowed-ips.json
// (written to automatically when addAllowedIp() is called from code).
const allowedIpSet = new Set();

function isValidIpFormat(ip) {
  return (
    /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) ||
    /^(\d{1,3}\.){3}\d{1,3}\/([0-9]|[12][0-9]|3[0-2])$/.test(ip) ||
    ip.includes(":")
  );
}

(function loadAllowedIps() {
  let skippedInvalid = 0;

  for (const ip of MANUALLY_ALLOWED_IPS) {
    const trimmed = String(ip).trim();
    if (!trimmed) continue;
    if (!isValidIpFormat(trimmed)) {
      skippedInvalid++;
      console.warn(`⚠️  Skipping invalid entry in MANUALLY_ALLOWED_IPS: "${ip}"`);
      continue;
    }
    allowedIpSet.add(trimmed);
  }

  const stored = loadJson(ALLOWED_IPS_FILE, {});
  for (const ip of Object.keys(stored)) allowedIpSet.add(ip);

  const fromEnv = (process.env.ALLOWED_IPS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const ip of fromEnv) allowedIpSet.add(ip);

  console.log(
    `👔 Loaded ${allowedIpSet.size} whitelisted IP(s)` +
      (skippedInvalid ? ` (${skippedInvalid} invalid entr${skippedInvalid === 1 ? "y" : "ies"} skipped)` : "")
  );
})();

function addAllowedIp(ip, label = "manually added") {
  allowedIpSet.add(ip);
  const stored = loadJson(ALLOWED_IPS_FILE, {});
  stored[ip] = { addedAt: Date.now(), label };
  fs.writeFileSync(ALLOWED_IPS_FILE, JSON.stringify(stored, null, 2));
}

// ---- Persistent per-browser employee token ----
// Solves the "my IP changed and now I'm blocked again" problem: instead of
// re-checking the visitor's current IP against a whitelist, a long-lived
// cookie proves "this browser already verified itself" once, regardless of
// what IP it's coming from today. Tokens are random and unguessable, and are
// checked against this server-side store, so a visitor can't forge one just
// by setting a cookie with a guessed value.
const EMPLOYEE_TOKEN_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000; // 1 year
const employeeTokens = new Map(); // token -> { addedAt, label, lastSeenIp, lastSeenAt }

(function loadEmployeeTokens() {
  const stored = loadJson(EMPLOYEE_TOKENS_FILE, {});
  for (const [token, entry] of Object.entries(stored)) {
    employeeTokens.set(token, entry);
  }
  console.log(`🍪 Loaded ${employeeTokens.size} remembered employee device(s)`);
})();

let tokenSaveTimer = null;
function saveEmployeeTokens() {
  if (tokenSaveTimer) return;
  tokenSaveTimer = setTimeout(() => {
    tokenSaveTimer = null;
    const obj = Object.fromEntries(employeeTokens);
    fs.writeFile(EMPLOYEE_TOKENS_FILE, JSON.stringify(obj, null, 2), (err) => {
      if (err) console.error(`Could not persist employee tokens: ${err.message}`);
    });
  }, SAVE_DEBOUNCE_MS);
}

function issueEmployeeToken(ip, label) {
  const token = crypto.randomBytes(24).toString("hex");
  employeeTokens.set(token, { addedAt: Date.now(), label, lastSeenIp: ip, lastSeenAt: Date.now() });
  saveEmployeeTokens();
  return token;
}

function isValidEmployeeToken(token) {
  return Boolean(token) && employeeTokens.has(token);
}

// Updates the on-file record when a remembered device shows up on a new IP,
// so you have a paper trail of "this device has moved around" if you ever
// need to audit it -- doesn't affect whether access is granted.
function noteEmployeeTokenSeen(token, ip) {
  const entry = employeeTokens.get(token);
  if (!entry) return;
  if (entry.lastSeenIp !== ip) {
    console.log(`Employee device seen on a new IP: ${ip} (was ${entry.lastSeenIp})`);
    entry.lastSeenIp = ip;
  }
  entry.lastSeenAt = Date.now();
  saveEmployeeTokens();
}

// ---- Auto-decision cache (allowed/blocked verdicts, LRU + TTL, persisted) ----
const ipCache = new Map(); // ip -> { status: 'allowed'|'blocked', reason, ts, ttl }
(function loadCache() {
  const stored = loadJson(IP_CACHE_FILE, {});
  for (const [ip, entry] of Object.entries(stored)) {
    ipCache.set(ip, entry);
  }
  console.log(`Loaded ${ipCache.size} cached IP verdict(s)`);
})();

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const obj = Object.fromEntries(ipCache);
    fs.writeFile(IP_CACHE_FILE, JSON.stringify(obj), (err) => {
      if (err) console.error(`Could not persist IP cache: ${err.message}`);
    });
  }, SAVE_DEBOUNCE_MS);
}

function setCacheEntry(ip, status, reason, ttl) {
  // Re-inserting moves the key to the "end" of Map's iteration order, which
  // combined with deleting the oldest key on overflow gives us simple LRU.
  if (ipCache.has(ip)) ipCache.delete(ip);
  ipCache.set(ip, { status, reason, ts: Date.now(), ttl });
  if (ipCache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = ipCache.keys().next().value;
    ipCache.delete(oldestKey);
  }
  scheduleSave();
}

// Clean expired entries once an hour so the persisted file doesn't bloat.
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [ip, entry] of ipCache.entries()) {
    const ttl = entry.ttl || CACHE_TTL_MS;
    if (now - entry.ts > ttl) {
      ipCache.delete(ip);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`IP cache cleaned: ${cleaned} expired entries removed`);
    scheduleSave();
  }
}, 60 * 60 * 1000);

// ============================================================
// PROXYCHECK.IO FALLBACK (only for IPs the local lists can't resolve)
// ============================================================
// proxycheck.io's own guidance: with &vpn=1, a "VPN" type hit also fires for
// plain datacenter/business infrastructure (corporate VPN gateways, Zscaler/
// Palo Alto-style security proxies, Apple Private Relay, etc), not just
// commercial VPN apps. Blocking every "type: VPN" hit outright over-blocks
// real customers sitting behind that kind of legitimate infrastructure.
// Their docs recommend only blocking "VPN" hits once the risk score crosses
// a threshold; anything flagged as an actual proxy/TOR/compromised server
// (not "VPN") is much higher-confidence and stays blocked regardless.
const VPN_RISK_BLOCK_THRESHOLD = Number(process.env.VPN_RISK_BLOCK_THRESHOLD) || 67;

let apiCallsToday = 0;
let apiCallDay = new Date().toDateString();

function canMakeApiCall() {
  const today = new Date().toDateString();
  if (today !== apiCallDay) {
    apiCallDay = today;
    apiCallsToday = 0;
  }
  if (apiCallsToday >= MAX_API_CALLS_PER_DAY) return false;
  apiCallsToday++;
  return true;
}

// Returns { verdict: 'blocked'|'allowed'|'unknown', reason }
async function checkWithProxyCheckApi(ip) {
  if (!canMakeApiCall()) {
    console.warn(`proxycheck.io daily quota reached, allowing ${ip} without an API check`);
    return { verdict: "unknown", reason: "api-quota" };
  }
  try {
    const keyParam = PROXYCHECK_API_KEY ? `&key=${PROXYCHECK_API_KEY}` : "";
    const url = `https://proxycheck.io/v2/${ip}?vpn=1&asn=0&risk=1${keyParam}`;
    const res = await axios.get(url, { timeout: PROXYCHECK_TIMEOUT_MS });
    const data = res.data && res.data[ip];
    if (!data) return { verdict: "unknown", reason: "api-empty" };

    if (data.proxy === "yes") {
      if (data.type === "VPN") {
        const risk = Number(data.risk) || 0;
        if (risk >= VPN_RISK_BLOCK_THRESHOLD) {
          return { verdict: "blocked", reason: `api:vpn-risk-${risk}` };
        }
        return { verdict: "allowed", reason: `api:vpn-low-risk-${risk}` };
      }
      // Non-VPN proxy types (open HTTP/SOCKS proxy, TOR, compromised server,
      // inference engine) are much higher-confidence bad actors -- block outright.
      return { verdict: "blocked", reason: `api:proxy-${data.type || "unknown"}` };
    }
    if (data.isocode === "IN") return { verdict: "blocked", reason: "api:country-IN" };
    return { verdict: "allowed", reason: "api:clean" };
  } catch (err) {
    console.error(`proxycheck.io check failed for ${ip}: ${err.message}`);
    return { verdict: "unknown", reason: "api-error" };
  }
}

// ============================================================
// MIDDLEWARE
// ============================================================
function isPrivateOrLocalIp(ip) {
  return (
    ip === "::1" ||
    ip === "127.0.0.1" ||
    ip.startsWith("192.168.") ||
    ip.startsWith("10.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

function getClientIp(req) {
  // Cloudflare (and some other CDNs) always set this to the real visitor IP,
  // regardless of whether Nginx is configured to unmask it in X-Forwarded-For.
  let ip = (
    req.headers["cf-connecting-ip"] ||
    req.headers["x-forwarded-for"]?.split(",")[0] ||
    req.socket.remoteAddress ||
    req.connection?.remoteAddress ||
    ""
  ).trim();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  return ip;
}

// ============================================================
// SELF-SERVICE EMPLOYEE WHITELIST
//
// Lets an employee add their own current IP to the whitelist without you
// touching the code or restarting the server -- they just need the shared
// access code below. addAllowedIp() already writes to disk AND updates the
// in-memory Set immediately, so it takes effect on their very next request.
//
// Set a real code via the EMPLOYEE_WHITELIST_CODE env var before relying on
// this -- the placeholder below is intentionally unusable so it's obvious if
// you forgot to set one.
// ============================================================
const EMPLOYEE_WHITELIST_CODE = process.env.EMPLOYEE_WHITELIST_CODE || "";
const WHITELIST_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const WHITELIST_RATE_LIMIT_MAX_ATTEMPTS = 8; // per IP, per window -- slows down code-guessing
const whitelistAttempts = new Map(); // ip -> { count, resetAt }

function isRateLimited(ip) {
  const now = Date.now();
  const entry = whitelistAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    whitelistAttempts.set(ip, { count: 1, resetAt: now + WHITELIST_RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > WHITELIST_RATE_LIMIT_MAX_ATTEMPTS;
}

const WHITELIST_FORM_HTML = (message = "") => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Employee Access</title>
<meta name="robots" content="noindex, nofollow" />
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
    background:#f4f6f8; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
  .card { background:#fff; max-width:380px; width:100%; padding:32px; border-radius:12px;
    box-shadow:0 4px 24px rgba(0,0,0,0.08); }
  h1 { font-size:18px; margin-bottom:8px; color:#111827; }
  p { font-size:13px; color:#6b7280; margin-bottom:20px; line-height:1.5; }
  input { width:100%; padding:10px 12px; border:1px solid #d1d5db; border-radius:8px;
    font-size:14px; margin-bottom:12px; }
  button { width:100%; padding:10px; background:#2563eb; color:#fff; border:none;
    border-radius:8px; font-size:14px; font-weight:500; cursor:pointer; }
  button:hover { background:#1d4ed8; }
  .msg { font-size:13px; margin-bottom:16px; padding:10px 12px; border-radius:8px; }
  .msg.error { background:#fef2f2; color:#b91c1c; }
  .msg.success { background:#f0fdf4; color:#15803d; }
</style>
</head>
<body>
  <div class="card">
    <h1>Employee Access</h1>
    <p>Enter your access code to allow this device/network to reach the site.</p>
    ${message}
    <form method="POST" action="/employee-whitelist">
      <input type="password" name="code" placeholder="Access code" required autofocus />
      <button type="submit">Add my IP</button>
    </form>
  </div>
</body>
</html>`;

function employeeWhitelistPage(req, res) {
  res.send(WHITELIST_FORM_HTML());
}

function employeeWhitelistSubmit(req, res) {
  const ip = getClientIp(req);

  if (!EMPLOYEE_WHITELIST_CODE) {
    console.error("EMPLOYEE_WHITELIST_CODE is not set -- refusing all self-whitelist requests");
    return res.status(503).send(WHITELIST_FORM_HTML('<div class="msg error">This feature isn\'t configured yet. Contact your admin.</div>'));
  }

  if (isRateLimited(ip)) {
    console.warn(`Employee whitelist: rate-limited ${ip} after too many attempts`);
    return res.status(429).send(WHITELIST_FORM_HTML('<div class="msg error">Too many attempts. Try again later.</div>'));
  }

  const submitted = String((req.body && req.body.code) || "");
  if (submitted !== EMPLOYEE_WHITELIST_CODE) {
    console.warn(`Employee whitelist: wrong code attempted from ${ip}`);
    return res.status(401).send(WHITELIST_FORM_HTML('<div class="msg error">Incorrect code.</div>'));
  }

  addAllowedIp(ip, `self-added via /employee-whitelist on ${new Date().toISOString()}`);
  const token = issueEmployeeToken(ip, `self-added via /employee-whitelist on ${new Date().toISOString()}`);
  res.cookie("employee_token", token, { maxAge: EMPLOYEE_TOKEN_MAX_AGE_MS, httpOnly: true });
  res.cookie("access_allowed", "true", { maxAge: 24 * 60 * 60 * 1000, httpOnly: true });
  console.log(`Employee whitelist: ${ip} added itself successfully`);
  res.send(WHITELIST_FORM_HTML(`<div class="msg success">Done! ${ip} now has permanent access. You can close this page.</div>`));
}

async function vpnCountryBlocker(req, res, next) {
  try {
    // 1) Always-allowed paths (the block page itself, retry, static assets,
    //    and the self-service whitelist form -- an employee who's currently
    //    blocked needs to be able to reach this page in the first place)
    if (
      ALWAYS_ALLOW_PATHS.has(req.path) ||
      req.path === "/employee-whitelist" ||
      STATIC_EXT_RE.test(req.path)
    ) {
      return next();
    }

    const ip = getClientIp(req);
    if (!ip) return next(); // can't determine IP -- fail open rather than lock everyone out

    // 2) Dev/local IPs
    if (isPrivateOrLocalIp(ip)) {
      return next();
    }

    // 3) Remembered employee device (cookie survives IP changes -- this is
    //    what fixes "my IP changed and I got blocked again" for good, as
    //    long as it's the same browser that verified itself before)
    const employeeToken = req.cookies.employee_token;
    if (isValidEmployeeToken(employeeToken)) {
      noteEmployeeTokenSeen(employeeToken, ip);
      return next();
    }

    // 4) Manual employee/admin whitelist -- always wins, no cookies, no cache needed
    if (
  allowedIpSet.has(ip) ||
  [...allowedIpSet].some(
    (allowedIp) =>
      allowedIp.includes("/") && ipMatchesCidr(ip, allowedIp)
  )
) {
  return next();
}

    // 5) Cookie shortcuts (avoids even a Map lookup on repeat requests)
    if (req.cookies.access_blocked === "true") {
      return res.status(403).sendFile(path.join(PUBLIC_DIR, "restricted.html"));
    }
    if (req.cookies.access_allowed === "true") {
      return next();
    }

    // 6) Persistent/in-memory verdict cache
    const cached = ipCache.get(ip);
    if (cached && Date.now() - cached.ts < (cached.ttl || CACHE_TTL_MS)) {
      if (cached.status === "blocked") {
        res.cookie("access_blocked", "true", { maxAge: 24 * 60 * 60 * 1000, httpOnly: true });
        console.log(`Blocked (cached, ${cached.reason}): ${ip}`);
        return res.status(403).sendFile(path.join(PUBLIC_DIR, "restricted.html"));
      }
      res.cookie("access_allowed", "true", { maxAge: 24 * 60 * 60 * 1000, httpOnly: true });
      return next();
    }

    // 7) Local CIDR list check -- free, instant, unlimited
    let verdict = null;
    let reason = null;
    const ipLong = ip.includes(":") ? null : ipToLong(ip);

    if (ipLong !== null) {
      if (ipInTable(ipLong, tables.india)) {
        verdict = "blocked";
        reason = "country:IN";
      } else if (ipInTable(ipLong, tables.vpn)) {
        verdict = "blocked";
        reason = "vpn";
      } else if (BLOCK_DATACENTER_IPS && ipInTable(ipLong, tables.datacenter)) {
        verdict = "blocked";
        reason = "datacenter";
      }
    }

    // 8) Ambiguous -> fall back to the rate-limited API (residential proxies,
    //    unlisted ranges, IPv6 addresses)
    if (verdict === null) {
      const apiResult = await checkWithProxyCheckApi(ip);
      if (apiResult.verdict === "unknown") {
        // Fail open, but re-check soon rather than trusting this permanently
        setCacheEntry(ip, "allowed", apiResult.reason, CACHE_TTL_ON_ERROR_MS);
        return next();
      }
      verdict = apiResult.verdict;
      reason = apiResult.reason;
    }

    setCacheEntry(ip, verdict, reason, CACHE_TTL_MS);

    if (verdict === "blocked") {
      res.cookie("access_blocked", "true", { maxAge: 24 * 60 * 60 * 1000, httpOnly: true });
      console.log(`Blocked (${reason}): ${ip}`);
      return res.status(403).sendFile(path.join(PUBLIC_DIR, "restricted.html"));
    }

    res.cookie("access_allowed", "true", { maxAge: 24 * 60 * 60 * 1000, httpOnly: true });
    console.log(`Allowed: ${ip}`);
    return next();
  } catch (err) {
    console.error("vpn-blocker middleware error:", err.message);
    return next(); // fail open -- never take the whole site down over a bug here
  }
}

// ============================================================
// /retry ROUTE HANDLER -- clears cookies + cache so a user can re-check
// (e.g. after turning their VPN off)
// ============================================================
function retryHandler(req, res) {
  const ip = getClientIp(req);
  if (ip) {
    ipCache.delete(ip);
    scheduleSave();
  }
  res.clearCookie("access_blocked");
  res.clearCookie("access_allowed");
  console.log(`Retry requested for ${ip}`);
  res.redirect("/");
}

module.exports = {
  vpnCountryBlocker,
  retryHandler,
  addAllowedIp,
  employeeWhitelistPage,
  employeeWhitelistSubmit,
  // exposed for debugging/monitoring only
  _stats: () => ({
    cacheSize: ipCache.size,
    allowedIpCount: allowedIpSet.size,
    apiCallsToday,
    listsSizes: {
      india: tables.india ? tables.india.starts.length : 0,
      vpn: tables.vpn ? tables.vpn.starts.length : 0,
      datacenter: tables.datacenter ? tables.datacenter.starts.length : 0,
    },
  }),
};