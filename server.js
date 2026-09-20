'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');

// Minimal .env loader (no dependency). Real secret values get written here
// via the workspace `write` tool, which preserves full fidelity — unlike
// passing them through process env parameters, which get redacted.
const ENV_FILE = path.join(__dirname, 'data', '.env');
if (fs.existsSync(ENV_FILE)) {
  const lines = fs.readFileSync(ENV_FILE, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

require('./src/db'); // ensure DB + admin seed run first

const { loadUser } = require('./src/middleware/auth');
const { CURRENCY } = require('./src/util');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(loadUser);

app.use((req, res, next) => {
  res.locals.path = req.path;
  res.locals.CURRENCY = CURRENCY;
  next();
});

app.use('/', require('./src/routes/auth'));
app.use('/', require('./src/routes/challenges'));
app.use('/', require('./src/routes/wallet'));
app.use('/', require('./src/routes/dashboard'));
app.use('/', require('./src/routes/admin'));
app.use('/', require('./src/routes/about'));

app.use((req, res) => {
  res.status(404).render('404');
});

const PORT = process.env.PORT || 3210;
app.listen(PORT, () => {
  console.log(`Long Challenge running on http://localhost:${PORT}`);
});
