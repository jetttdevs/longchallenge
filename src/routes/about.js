'use strict';
const express = require('express');
const router = express.Router();
const { db } = require('../db');

router.get('/about', (req, res) => {
  const stats = {
    challenges: db.prepare('SELECT COUNT(*) AS n FROM challenges').get().n,
    published: db.prepare(`SELECT COUNT(*) AS n FROM challenges WHERE status IN ('published','completed')`).get().n,
    completed: db.prepare(`SELECT COUNT(*) AS n FROM challenges WHERE status = 'completed'`).get().n,
    users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
  };
  res.render('about', { stats });
});

module.exports = router;
