'use strict';
const { db } = require('../db');
const { parseSessionCookie } = require('../auth');

function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const parts = header.split(';').map((p) => p.trim());
  for (const p of parts) {
    if (p.startsWith(name + '=')) return decodeURIComponent(p.slice(name.length + 1));
  }
  return null;
}

function loadUser(req, res, next) {
  const cookieVal = getCookie(req, 'lc_session');
  const uid = parseSessionCookie(cookieVal);
  if (uid) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
    req.user = user || null;
  } else {
    req.user = null;
  }
  res.locals.user = req.user;
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    req.session_flash = 'Please log in first.';
    return res.redirect('/login');
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).send('Forbidden — admin only.');
  }
  next();
}

module.exports = { loadUser, requireAuth, requireAdmin, getCookie };
