'use strict';
const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { requireAdmin } = require('../middleware/auth');

router.get('/admin', requireAdmin, (req, res) => {
  const pendingChallenges = db
    .prepare(
      `SELECT c.*, u.x_username AS creator_name FROM challenges c JOIN users u ON u.id = c.creator_id
       WHERE c.status = 'pending_review' ORDER BY c.created_at ASC`
    )
    .all();
  const pendingSubmissions = db
    .prepare(
      `SELECT s.*, u.x_username AS username, c.title AS challenge_title, c.reward_tokens
       FROM submissions s
       JOIN users u ON u.id = s.user_id
       JOIN challenges c ON c.id = s.challenge_id
       WHERE s.status = 'pending' ORDER BY s.created_at ASC`
    )
    .all();
  const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  const stats = {
    users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    challenges: db.prepare('SELECT COUNT(*) AS n FROM challenges').get().n,
    published: db.prepare(`SELECT COUNT(*) AS n FROM challenges WHERE status = 'published'`).get().n,
    completed: db.prepare(`SELECT COUNT(*) AS n FROM challenges WHERE status = 'completed'`).get().n,
    tokensInCirculation: db.prepare('SELECT COALESCE(SUM(token_balance),0) AS n FROM users WHERE is_admin = 0').get().n,
  };
  res.render('admin', {
    pendingChallenges,
    pendingSubmissions,
    users,
    stats,
    tab: req.query.tab || 'challenges',
  });
});

router.post('/admin/challenges/:id/approve', requireAdmin, (req, res) => {
  const c = db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id);
  if (c && c.status === 'pending_review') {
    db.prepare(`UPDATE challenges SET status = 'published', reviewed_at = datetime('now') WHERE id = ?`).run(c.id);
  }
  res.redirect('/admin?tab=challenges');
});

router.post('/admin/challenges/:id/reject', requireAdmin, (req, res) => {
  const c = db.prepare('SELECT * FROM challenges WHERE id = ?').get(req.params.id);
  if (c && c.status === 'pending_review') {
    const reason = (req.body.reason || 'Not specified').trim();
    db.exec('BEGIN');
    try {
      const refund = c.reward_tokens + c.fee_tokens;
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(c.creator_id);
      const newBalance = user.token_balance + refund;
      db.prepare('UPDATE users SET token_balance = ? WHERE id = ?').run(newBalance, user.id);
      db.prepare(
        'INSERT INTO transactions (user_id, type, amount, balance_after, ref_challenge_id, note) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(user.id, 'escrow_refund', refund, newBalance, c.id, `Refund: challenge rejected — ${reason}`);
      db.prepare(
        `UPDATE challenges SET status = 'rejected', rejection_reason = ?, reviewed_at = datetime('now') WHERE id = ?`
      ).run(reason, c.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
    }
  }
  res.redirect('/admin?tab=challenges');
});

router.post('/admin/submissions/:id/approve', requireAdmin, (req, res) => {
  const s = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (!s || s.status !== 'pending') return res.redirect('/admin?tab=submissions');
  const c = db.prepare('SELECT * FROM challenges WHERE id = ?').get(s.challenge_id);
  if (!c || c.status !== 'published') return res.redirect('/admin?tab=submissions');

  db.exec('BEGIN');
  try {
    const winner = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
    const newBalance = winner.token_balance + c.reward_tokens;
    db.prepare('UPDATE users SET token_balance = ? WHERE id = ?').run(newBalance, winner.id);
    db.prepare(
      'INSERT INTO transactions (user_id, type, amount, balance_after, ref_challenge_id, note) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(winner.id, 'escrow_release', c.reward_tokens, newBalance, c.id, `Reward for winning "${c.title}"`);
    db.prepare(`UPDATE submissions SET status = 'approved', reviewed_at = datetime('now') WHERE id = ?`).run(s.id);
    db.prepare(
      `UPDATE submissions SET status = 'rejected', rejection_reason = 'Another submission was selected as the winner.', reviewed_at = datetime('now')
       WHERE challenge_id = ? AND id != ? AND status = 'pending'`
    ).run(c.id, s.id);
    db.prepare(
      `UPDATE challenges SET status = 'completed', winner_submission_id = ?, reviewed_at = datetime('now') WHERE id = ?`
    ).run(s.id, c.id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
  }
  res.redirect('/admin?tab=submissions');
});

router.post('/admin/submissions/:id/reject', requireAdmin, (req, res) => {
  const s = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  if (s && s.status === 'pending') {
    const reason = (req.body.reason || 'Not specified').trim();
    db.prepare(
      `UPDATE submissions SET status = 'rejected', rejection_reason = ?, reviewed_at = datetime('now') WHERE id = ?`
    ).run(reason, s.id);
  }
  res.redirect('/admin?tab=submissions');
});

router.post('/admin/users/:id/adjust', requireAdmin, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  const amount = parseInt(req.body.amount, 10);
  if (user && Number.isFinite(amount) && amount !== 0) {
    const newBalance = Math.max(0, user.token_balance + amount);
    const actual = newBalance - user.token_balance;
    db.prepare('UPDATE users SET token_balance = ? WHERE id = ?').run(newBalance, user.id);
    db.prepare(
      'INSERT INTO transactions (user_id, type, amount, balance_after, note) VALUES (?, ?, ?, ?, ?)'
    ).run(user.id, 'admin_adjust', actual, newBalance, (req.body.note || '').trim() || 'Admin balance adjustment');
  }
  res.redirect('/admin?tab=users');
});

module.exports = router;
