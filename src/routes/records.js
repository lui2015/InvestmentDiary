// src/routes/records.js - 账户 / 标的 / 交易记录 / 市价
const express = require('express');
const db = require('../db');
const router = express.Router();

const uid = (req) => req.user.id;

// ---------- 账户 ----------
router.get('/accounts', (req, res) => {
  const rows = db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at DESC').all(uid(req));
  res.json({ code: 0, data: rows });
});
router.post('/accounts', (req, res) => {
  const { name, broker, type } = req.body || {};
  if (!name) return res.status(400).json({ code: 1, message: '账户名称必填' });
  const info = db.prepare('INSERT INTO accounts (user_id, name, broker, type, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(uid(req), name, broker || '', type || '', Date.now());
  res.json({ code: 0, data: { id: info.lastInsertRowid } });
});
router.delete('/accounts/:id', (req, res) => {
  db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').run(req.params.id, uid(req));
  res.json({ code: 0 });
});

// ---------- 标的 ----------
router.get('/symbols', (req, res) => {
  // 自动为用户初始化预设投资标的（仅首次，已有标的则跳过）
  const { seedDefaultSymbols } = require('../db');
  seedDefaultSymbols(uid(req));
  const rows = db.prepare('SELECT * FROM symbols WHERE user_id = ? ORDER BY category, created_at').all(uid(req));
  res.json({ code: 0, data: rows });
});
router.post('/symbols', (req, res) => {
  const { category, code, name, market, direction, leverage, multiplier, extra } = req.body || {};
  if (!name || !['stock', 'fund', 'future', 'bond', 'other'].includes(category))
    return res.status(400).json({ code: 1, message: '标的名称与合法品类必填' });
  const info = db.prepare(`INSERT INTO symbols
    (user_id, category, code, name, market, direction, leverage, multiplier, extra, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uid(req), category, code || '', name, market || '',
      direction || 'long', leverage ? parseFloat(leverage) : null,
      multiplier ? parseFloat(multiplier) : 1, extra ? JSON.stringify(extra) : null, Date.now());
  res.json({ code: 0, data: { id: info.lastInsertRowid } });
});
router.delete('/symbols/:id', (req, res) => {
  db.prepare('DELETE FROM symbols WHERE id = ? AND user_id = ?').run(req.params.id, uid(req));
  res.json({ code: 0 });
});

// ---------- 交易记录 ----------
router.get('/trades', (req, res) => {
  const { symbol_id, category, limit } = req.query;
  let sql = `SELECT t.*, s.name AS symbol_name, s.category, s.code AS symbol_code
             FROM trades t JOIN symbols s ON s.id = t.symbol_id WHERE t.user_id = ?`;
  const params = [uid(req)];
  if (symbol_id) { sql += ' AND t.symbol_id = ?'; params.push(symbol_id); }
  if (category) { sql += ' AND s.category = ?'; params.push(category); }
  sql += ' ORDER BY t.datetime DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit)); }
  const rows = db.prepare(sql).all(...params);
  res.json({ code: 0, data: rows });
});
router.post('/trades', (req, res) => {
  const b = req.body || {};
  const { account_id, symbol_id, symbol_name, category, action, side, quantity, price, fee, datetime, note } = b;
  if (!['open', 'add', 'reduce', 'close', 'dividend', 'fee'].includes(action))
    return res.status(400).json({ code: 1, message: '动作类型必填且合法' });
  if (!['buy', 'sell'].includes(side)) return res.status(400).json({ code: 1, message: '方向需为 buy/sell' });
  const q = parseFloat(quantity); const p = parseFloat(price);
  if (!(q > 0) || !(p >= 0)) return res.status(400).json({ code: 1, message: '数量价格非法' });

  // 确定标的 ID：优先用 symbol_id，否则按 symbol_name+category 自动查找或创建
  let sid = symbol_id;
  if (!sid && symbol_name) {
    if (!category || !['stock', 'fund', 'future', 'bond', 'other'].includes(category))
      return res.status(400).json({ code: 1, message: '分类必填且需为 stock/fund/future/bond/other' });
    const existing = db.prepare('SELECT id FROM symbols WHERE user_id = ? AND name = ? AND category = ?')
      .get(uid(req), symbol_name.trim(), category);
    if (existing) {
      sid = existing.id;
    } else {
      const info = db.prepare(`INSERT INTO symbols (user_id, category, code, name, market, direction, multiplier, created_at)
        VALUES (?, ?, '', ?, '', 'long', 1, ?)`)
        .run(uid(req), category, symbol_name.trim(), Date.now());
      sid = info.lastInsertRowid;
    }
  }

  if (!sid) return res.status(400).json({ code: 1, message: '标的不存在，请输入标的名称' });
  const sym = db.prepare('SELECT id FROM symbols WHERE id = ? AND user_id = ?').get(sid, uid(req));
  if (!sym) return res.status(400).json({ code: 1, message: '标的不存在' });

  const amount = q * p;
  const info = db.prepare(`INSERT INTO trades
    (user_id, account_id, symbol_id, action, side, quantity, price, amount, fee, datetime, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uid(req), account_id || null, sid, action, side, q, p, amount,
      parseFloat(fee || 0), new Date(datetime || Date.now()).getTime(), note || '', Date.now());
  res.json({ code: 0, data: { id: info.lastInsertRowid } });
});
router.delete('/trades/:id', (req, res) => {
  db.prepare('DELETE FROM trades WHERE id = ? AND user_id = ?').run(req.params.id, uid(req));
  res.json({ code: 0 });
});

// ---------- 市价维护 ----------
router.put('/prices/:symbol_id', (req, res) => {
  const price = parseFloat(req.body && req.body.price);
  if (!(price >= 0)) return res.status(400).json({ code: 1, message: '价格非法' });
  const sid = req.params.symbol_id;
  db.prepare(`INSERT INTO market_prices (user_id, symbol_id, price, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, symbol_id) DO UPDATE SET price = excluded.price, updated_at = excluded.updated_at`)
    .run(uid(req), sid, price, Date.now());
  res.json({ code: 0 });
});

module.exports = router;
