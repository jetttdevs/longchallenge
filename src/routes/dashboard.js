'use strict';
const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');

router.get('/dashboard', requireAuth, (req, res) => {
  const myChallenges = db
    .prepare('SELECT * FROM challenges WHERE creator_id = ? ORDER BY created_at DESC')
    .all(req.user.id);
  const mySubmissions = db
    .prepare(
      `SELECT s.*, c.title AS challenge_title, c.status AS challenge_status
       FROM submissions s JOIN challenges c ON c.id = s.challenge_id
       WHERE s.user_id = ? ORDER BY s.created_at DESC`
    )
    .all(req.user.id);
  res.render('dashboard', { myChallenges, mySubmissions });
});

module.exports = router;
