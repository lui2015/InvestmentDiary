// src/routes/reviews.js - 投资复盘
const express = require('express');
const db = require('../db');
const router = express.Router();

const uid = (req) => req.user.id;

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM reviews WHERE user_id = ? ORDER BY start_date DESC').all(uid(req));
  rows.forEach(r => { try { r.content = JSON.parse(r.content); } catch (e) { r.content = {}; } });
  res.json({ code: 0, data: rows });
});
router.post('/', (req, res) => {
  const { period_type, start_date, end_date, content } = req.body || {};
  if (!period_type || !start_date || !end_date)
    return res.status(400).json({ code: 1, message: '周期类型与起止时间必填' });
  const info = db.prepare(`INSERT INTO reviews (user_id, period_type, start_date, end_date, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(uid(req), period_type, new Date(start_date).getTime(), new Date(end_date).getTime(),
      JSON.stringify(content || {}), Date.now());
  res.json({ code: 0, data: { id: info.lastInsertRowid } });
});
router.put('/:id', (req, res) => {
  const { period_type, start_date, end_date, content } = req.body || {};
  db.prepare(`UPDATE reviews SET period_type = ?, start_date = ?, end_date = ?, content = ?
    WHERE id = ? AND user_id = ?`)
    .run(period_type, new Date(start_date).getTime(), new Date(end_date).getTime(),
      JSON.stringify(content || {}), req.params.id, uid(req));
  res.json({ code: 0 });
});
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM reviews WHERE id = ? AND user_id = ?').run(req.params.id, uid(req));
  res.json({ code: 0 });
});

// 复盘模板
router.get('/template', (req, res) => {
  res.json({ code: 0, data: {
    fields: [
      { key: 'operations', label: '本期操作回顾', type: 'text', hint: '做了什么买卖？' },
      { key: 'logic', label: '决策逻辑', type: 'text', hint: '为什么买/卖，依据是什么？' },
      { key: 'result', label: '结果评估', type: 'text', hint: '符合预期吗，偏差原因？' },
      { key: 'emotion', label: '情绪与纪律', type: 'text', hint: '是否受情绪影响、是否遵守计划？' },
      { key: 'lesson', label: '经验沉淀', type: 'text', hint: '下次改进点？' }
    ]
  }});});

module.exports = router;
