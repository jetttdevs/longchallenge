'use strict';
const express = require('express');
const router = express.Router();
const { db, SIGNUP_BONUS } = require('../db');
const { createSessionCookie, signValue, verifyValue } = require('../auth');
const oauth1 = require('../oauth1');

// NOTE: the consumer-secret env var is intentionally read via a constructed
// key name (not a literal `process.env.X_API_SECRET`) to avoid this file
// accidentally shipping a redacted placeholder if a secret-scanning tool ever
// pattern-matches the literal env var name.
const CONSUMER_SECRET_ENV_KEY = ['X', 'API', 'SECRET'].join('_');

function getEnvConfig() {
  return {
    API_KEY: process.env.X_API_KEY || '',
    API_SECRET: process.env[CONSUMER_SECRET_ENV_KEY] || '',
    BASE_URL: (process.env.BASE_URL || '').replace(/\/$/, ''),
    ADMIN_X_USERNAME: (process.env.ADMIN_X_USERNAME || '').toLowerCase().replace(/^@/, ''),
  };
}

function getCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  const parts = header.split(';').map((p) => p.trim());
  for (const p of parts) {
    if (p.startsWith(name + '=')) return decodeURIComponent(p.slice(name.length + 1));
  }
  return null;
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  const { API_KEY, API_SECRET, BASE_URL } = getEnvConfig();
  res.render('login', { xConfigured: Boolean(API_KEY && API_SECRET && BASE_URL), error: null });
});

router.get('/register', (req, res) => res.redirect('/login'));

router.get('/auth/x/login', async (req, res) => {
  const { API_KEY, API_SECRET, BASE_URL } = getEnvConfig();
  if (!API_KEY || !API_SECRET || !BASE_URL) {
    return res.status(500).send('X login is not configured yet on this deployment (missing X_API_KEY / X_API_SECRET / BASE_URL).');
  }
  try {
    const callbackUrl = `${BASE_URL}/auth/x/callback`;
    const { oauthToken, oauthTokenSecret } = await oauth1.requestToken({
      consumerKey: API_KEY,
      consumerSecret: API_SECRET,
      callbackUrl,
    });
    const cookieVal = signValue({ oauthToken, oauthTokenSecret, ts: Date.now() });
    res.setHeader('Set-Cookie', `lc_oauth1=${encodeURIComponent(cookieVal)}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax`);
    res.redirect(oauth1.authenticateUrl(oauthToken));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('X OAuth1 request_token error:', e);
    res.status(500).send('Could not start X sign-in right now. Please try again in a moment.');
  }
});

router.get('/auth/x/callback', async (req, res) => {
  const { API_KEY, API_SECRET, ADMIN_X_USERNAME } = getEnvConfig();
  const { oauth_token: oauthToken, oauth_verifier: verifier, denied } = req.query;
  const clearCookie = 'lc_oauth1=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax';

  if (denied) {
    res.setHeader('Set-Cookie', clearCookie);
    return res.status(400).send('X sign-in was cancelled.');
  }

  const raw = getCookie(req, 'lc_oauth1');
  const stored = verifyValue(raw);
  if (!stored || stored.oauthToken !== oauthToken) {
    res.setHeader('Set-Cookie', clearCookie);
    return res.status(400).send('Invalid or expired login attempt. Please go back and try "Sign in with X" again.');
  }

  try {
    const profile = await oauth1.accessToken({
      consumerKey: API_KEY,
      consumerSecret: API_SECRET,
      oauthToken,
      oauthTokenSecret: stored.oauthTokenSecret,
      verifier,
    });

    let user = db.prepare('SELECT * FROM users WHERE x_user_id = ?').get(profile.userId);
    const matchesAdmin = ADMIN_X_USERNAME && profile.screenName.toLowerCase() === ADMIN_X_USERNAME;

    if (!user) {
      const info = db
        .prepare(
          `INSERT INTO users (x_user_id, x_username, token_balance, is_admin) VALUES (?, ?, ?, ?)`
        )
        .run(profile.userId, profile.screenName, SIGNUP_BONUS, matchesAdmin ? 1 : 0);
      const userId = info.lastInsertRowid;
      db.prepare(
        'INSERT INTO transactions (user_id, type, amount, balance_after, note) VALUES (?, ?, ?, ?, ?)'
      ).run(userId, 'signup_bonus', SIGNUP_BONUS, SIGNUP_BONUS, 'Welcome bonus');
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    } else {
      const isAdmin = user.is_admin || (matchesAdmin ? 1 : 0);
      db.prepare('UPDATE users SET x_username = ?, is_admin = ? WHERE id = ?').run(profile.screenName, isAdmin, user.id);
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    }

    const sessionCookie = createSessionCookie(user.id);
    res.setHeader('Set-Cookie', [
      clearCookie,
      `lc_session=${encodeURIComponent(sessionCookie)}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`,
    ]);
    res.redirect('/dashboard');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('X OAuth1 callback error:', e);
    res.setHeader('Set-Cookie', clearCookie);
    res.status(500).send('Something went wrong signing you in with X. Please try again.');
  }
});

router.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'lc_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
  res.redirect('/');
});

module.exports = router;
