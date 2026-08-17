// src/routes/pref.js - 用户偏好（主题等）
const express = require('express');
const db = require('../db');
const router = express.Router();

const THEMES = ['light', 'dark', 'cyberpunk', 'comic', 'auto'];

router.get('/', (req, res) => {
  const row = db.prepare('SELECT theme FROM user_prefs WHERE user_id = ?').get(req.user.id);
  res.json({ code: 0, data: { theme: row ? row.theme : 'light', themes: THEMES } });
});
router.put('/theme', (req, res) => {
  const { theme } = req.body || {};
  if (!THEMES.includes(theme)) return res.status(400).json({ code: 1, message: '主题不合法' });
  db.prepare(`INSERT INTO user_prefs (user_id, theme, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET theme = excluded.theme, updated_at = excluded.updated_at`)
    .run(req.user.id, theme, Date.now());
  res.json({ code: 0, data: { theme } });
});

// 数据导出
router.get('/export', (req, res) => {
  const u = req.user.id;
  const data = {
    user: db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(u),
    accounts: db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(u),
    symbols: db.prepare('SELECT * FROM symbols WHERE user_id = ?').all(u),
    trades: db.prepare('SELECT * FROM trades WHERE user_id = ?').all(u),
    alert_rules: db.prepare('SELECT * FROM alert_rules WHERE user_id = ?').all(u),
    reviews: db.prepare('SELECT * FROM reviews WHERE user_id = ?').all(u)
  };
  res.setHeader('Content-Disposition', 'attachment; filename="investment-diary-export.json"');
  res.json({ code: 0, data });
});

module.exports = router;
