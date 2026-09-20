'use strict';
const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { CATEGORIES, computeFee, CURRENCY } = require('../util');

router.get('/', (req, res) => {
  const category = req.query.category || '';
  let rows;
  if (category) {
    rows = db
      .prepare(
        `SELECT c.*, u.x_username AS creator_name,
          (SELECT COUNT(*) FROM submissions s WHERE s.challenge_id = c.id) AS submission_count
         FROM challenges c JOIN users u ON u.id = c.creator_id
         WHERE c.status = 'published' AND c.category = ?
         ORDER BY c.created_at DESC`
      )
      .all(category);
  } else {
    rows = db
      .prepare(
        `SELECT c.*, u.x_username AS creator_name,
          (SELECT COUNT(*) FROM submissions s WHERE s.challenge_id = c.id) AS submission_count
         FROM challenges c JOIN users u ON u.id = c.creator_id
         WHERE c.status = 'published'
         ORDER BY c.created_at DESC`
      )
      .all();
  }
  res.render('index', { challenges: rows, CATEGORIES, activeCategory: category });
});

router.get('/challenges/new', requireAuth, (req, res) => {
  res.render('challenge_new', { error: null, CATEGORIES, form: {} });
});

router.post('/challenges/new', requireAuth, (req, res) => {
  const { title, category, description, reward, deadline } = req.body;
  const rewardTokens = parseInt(reward, 10);
  const errBase = { CATEGORIES, form: req.body };
  if (!title || String(title).trim().length < 4) {
    return res.render('challenge_new', { ...errBase, error: 'Title must be at least 4 characters.' });
  }
  if (!CATEGORIES.find((c) => c.id === category)) {
    return res.render('challenge_new', { ...errBase, error: 'Pick a valid category.' });
  }
  if (!description || String(description).trim().length < 10) {
    return res.render('challenge_new', { ...errBase, error: 'Describe what the winner needs to do (min 10 characters).' });
  }
  if (!Number.isFinite(rewardTokens) || rewardTokens < 1) {
    return res.render('challenge_new', { ...errBase, error: `Reward must be a positive number of ${CURRENCY.symbol}.` });
  }
  const fee = computeFee(rewardTokens);
  const total = rewardTokens + fee;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (user.token_balance < total) {
    return res.render('challenge_new', {
      ...errBase,
      error: `Insufficient balance. Creating this challenge needs ${total} ${CURRENCY.symbol} (reward ${rewardTokens} + ${fee} platform fee escrow), you have ${user.token_balance} ${CURRENCY.symbol}.`,
    });
  }

  const tx = db.prepare('BEGIN');
  db.exec('BEGIN');
  try {
    const info = db
      .prepare(
        `INSERT INTO challenges (creator_id, title, category, description, reward_tokens, fee_tokens, deadline, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_review')`
      )
      .run(req.user.id, String(title).trim(), category, String(description).trim(), rewardTokens, fee, deadline || null);
    const challengeId = info.lastInsertRowid;
    const newBalance = user.token_balance - total;
    db.prepare('UPDATE users SET token_balance = ? WHERE id = ?').run(newBalance, user.id);
    db.prepare(
      'INSERT INTO transactions (user_id, type, amount, balance_after, ref_challenge_id, note) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(user.id, 'escrow_hold', -total, newBalance, challengeId, `Escrow for "${title}" (reward ${rewardTokens} + fee ${fee})`);
    db.exec('COMMIT');
    res.redirect(`/challenges/${challengeId}`);
  } catch (e) {
    db.exec('ROLLBACK');
    res.render('challenge_new', { ...errBase, error: 'Something went wrong creating the challenge. Please try again.' });
  }
});

router.get('/challenges/:id', (req, res) => {
  const challenge = db
    .prepare(`SELECT c.*, u.x_username AS creator_name FROM challenges c JOIN users u ON u.id = c.creator_id WHERE c.id = ?`)
    .get(req.params.id);
  if (!challenge) return res.status(404).send('Challenge not found.');

  const isOwnerOrAdmin = req.user && (req.user.id === challenge.creator_id || req.user.is_admin);
  let submissions;
  if (isOwnerOrAdmin) {
    submissions = db
      .prepare(
        `SELECT s.*, u.x_username AS username FROM submissions s JOIN users u ON u.id = s.user_id WHERE s.challenge_id = ? ORDER BY s.created_at DESC`
      )
      .all(challenge.id);
  } else if (req.user) {
    submissions = db
      .prepare(
        `SELECT s.*, u.x_username AS username FROM submissions s JOIN users u ON u.id = s.user_id WHERE s.challenge_id = ? AND s.user_id = ? ORDER BY s.created_at DESC`
      )
      .all(challenge.id, req.user.id);
  } else {
    submissions = [];
  }
  const submissionCount = db
    .prepare('SELECT COUNT(*) AS n FROM submissions WHERE challenge_id = ?')
    .get(challenge.id).n;

  res.render('challenge_detail', {
    challenge,
    submissions,
    submissionCount,
    isOwnerOrAdmin,
    error: null,
  });
});

router.post('/challenges/:id/submit', requireAuth, (req, res) => {
  const challenge = db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id);
  if (!challenge) return res.status(404).send('Challenge not found.');
  if (challenge.status !== 'published') {
    return res.redirect(`/challenges/${challenge.id}`);
  }
  if (challenge.creator_id === req.user.id) {
    return res.redirect(`/challenges/${challenge.id}`);
  }
  const { content_url, note } = req.body;
  if (!content_url || !/^https?:\/\//i.test(content_url.trim())) {
    return res.render('challenge_detail', {
      challenge,
      submissions: db
        .prepare(`SELECT s.*, u.x_username AS username FROM submissions s JOIN users u ON u.id = s.user_id WHERE s.challenge_id = ? AND s.user_id = ? ORDER BY s.created_at DESC`)
        .all(challenge.id, req.user.id),
      submissionCount: db.prepare('SELECT COUNT(*) AS n FROM submissions WHERE challenge_id = ?').get(challenge.id).n,
      isOwnerOrAdmin: false,
      error: 'Please provide a valid link (starting with http:// or https://) to your work.',
    });
  }
  db.prepare(
    `INSERT INTO submissions (challenge_id, user_id, content_url, note, status) VALUES (?, ?, ?, ?, 'pending')`
  ).run(challenge.id, req.user.id, content_url.trim(), (note || '').trim() || null);
  res.redirect(`/challenges/${challenge.id}`);
});

module.exports = router;
