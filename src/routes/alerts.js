// src/routes/alerts.js - 止盈止损提醒
const express = require('express');
const db = require('../db');
const portfolio = require('../portfolio');
const router = express.Router();

const uid = (req) => req.user.id;

// 规则列表
router.get('/rules', (req, res) => {
  const rows = db.prepare(`SELECT r.*, s.name AS symbol_name, s.code AS symbol_code
    FROM alert_rules r JOIN symbols s ON s.id = r.symbol_id
    WHERE r.user_id = ? ORDER BY r.created_at DESC`).all(uid(req));
  res.json({ code: 0, data: rows });
});
router.post('/rules', (req, res) => {
  const { symbol_id, type, mode, threshold } = req.body || {};
  if (!symbol_id || !['stop_profit', 'stop_loss'].includes(type))
    return res.status(400).json({ code: 1, message: '标的与类型必填' });
  if (!['percent', 'price'].includes(mode)) return res.status(400).json({ code: 1, message: '模式需为 percent/price' });
  const th = parseFloat(threshold);
  if (!(th > 0)) return res.status(400).json({ code: 1, message: '阈值需为正数' });
  const sym = db.prepare('SELECT id FROM symbols WHERE id = ? AND user_id = ?').get(symbol_id, uid(req));
  if (!sym) return res.status(400).json({ code: 1, message: '标的不存在' });
  const info = db.prepare(`INSERT INTO alert_rules (user_id, symbol_id, type, mode, threshold, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?)`).run(uid(req), symbol_id, type, mode, th, Date.now());
  res.json({ code: 0, data: { id: info.lastInsertRowid } });
});
router.delete('/rules/:id', (req, res) => {
  db.prepare('DELETE FROM alert_rules WHERE id = ? AND user_id = ?').run(req.params.id, uid(req));
  res.json({ code: 0 });
});

// 提醒日志
router.get('/logs', (req, res) => {
  const rows = db.prepare(`SELECT l.*, s.name AS symbol_name FROM alert_logs l
    JOIN symbols s ON s.id = l.symbol_id WHERE l.user_id = ? ORDER BY l.triggered_at DESC`).all(uid(req));
  res.json({ code: 0, data: rows });
});
router.post('/logs/:id/handle', (req, res) => {
  db.prepare('UPDATE alert_logs SET handled = 1 WHERE id = ? AND user_id = ?').run(req.params.id, uid(req));
  res.json({ code: 0 });
});

// 触发检测（可由前端或定时任务调用）
router.post('/check', (req, res) => {
  const positions = portfolio.computePositions(uid(req));
  const posMap = {};
  positions.forEach(p => { posMap[p.symbol_id] = p; });
  const rules = db.prepare('SELECT * FROM alert_rules WHERE user_id = ? AND status = \'active\'').all(uid(req));
  const now = Date.now();
  const triggered = [];
  for (const r of rules) {
    const p = posMap[r.symbol_id];
    if (!p || p.market_price == null || p.avg_cost <= 0) continue;
    const changePct = ((p.market_price - p.avg_cost) / p.avg_cost) * 100;
    let hit = false;
    if (r.mode === 'percent') {
      if (r.type === 'stop_profit' && changePct >= r.threshold) hit = true;
      if (r.type === 'stop_loss' && changePct <= -r.threshold) hit = true;
    } else { // price
      if (r.type === 'stop_profit' && p.market_price >= r.threshold) hit = true;
      if (r.type === 'stop_loss' && p.market_price <= r.threshold) hit = true;
    }
    if (hit && (!r.last_triggered || now - r.last_triggered > 24 * 3600 * 1000)) {
      const msg = `${p.name} 触发${r.type === 'stop_profit' ? '止盈' : '止损'}（${r.mode === 'percent' ? '波动 ' + changePct.toFixed(2) + '%' : '现价 ' + p.market_price}），请关注。`;
      const info = db.prepare(`INSERT INTO alert_logs (user_id, rule_id, symbol_id, type, message, triggered_at, handled)
        VALUES (?, ?, ?, ?, ?, ?, 0)`).run(uid(req), r.id, r.symbol_id, r.type, msg, now);
      db.prepare('UPDATE alert_rules SET last_triggered = ? WHERE id = ?').run(now, r.id);
      triggered.push({ id: info.lastInsertRowid, message: msg });
    }
  }
  res.json({ code: 0, data: triggered });
});

module.exports = router;
