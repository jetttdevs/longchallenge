'use strict';
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// --- Stateless signed cookie helpers (HMAC-SHA256) ---
// Used for both the login session cookie and the short-lived X OAuth
// state/PKCE-verifier cookie. No server-side session store needed.
const SECRET_PATH = path.join(__dirname, '..', 'data', 'session_secret.txt');
function getSessionSecret() {
  const dir = path.dirname(SECRET_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(SECRET_PATH)) {
    fs.writeFileSync(SECRET_PATH, crypto.randomBytes(32).toString('hex'));
  }
  return fs.readFileSync(SECRET_PATH, 'utf8').trim();
}
const SESSION_SECRET = getSessionSecret();

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('hex');
}

function signValue(obj) {
  const payload = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

function verifyValue(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function createSessionCookie(userId) {
  return signValue({ uid: userId, t: Date.now() });
}

function parseSessionCookie(cookieVal) {
  const data = verifyValue(cookieVal);
  return data ? data.uid : null;
}

module.exports = { signValue, verifyValue, createSessionCookie, parseSessionCookie };
