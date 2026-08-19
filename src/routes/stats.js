// src/routes/stats.js
const express = require('express');
const portfolio = require('../portfolio');
const router = express.Router();

router.get('/overview', (req, res) => {
  const overview = portfolio.computeOverview(req.user.id);
  const positions = portfolio.computePositions(req.user.id);
  const discipline = portfolio.computeDiscipline(req.user.id);
  const byCategory = {};
  for (const p of positions) {
    if (p.qty <= 0) continue;
    const c = p.category;
    byCategory[c] = byCategory[c] || { cost: 0, market: 0, float: 0 };
    byCategory[c].cost += p.avg_cost * p.qty * (p.multiplier || 1);
    byCategory[c].market += p.market_value || 0;
    byCategory[c].float += (p.float_pnl || 0);
  }
  const categoryData = Object.keys(byCategory).map(k => ({
    category: k, cost: Math.round(byCategory[k].cost * 100) / 100,
    market: Math.round(byCategory[k].market * 100) / 100,
    float: Math.round(byCategory[k].float * 100) / 100
  }));
  res.json({ code: 0, data: { overview, positions, categoryData, discipline } });
});

router.get('/ranking', (req, res) => {
  const positions = portfolio.computePositions(req.user.id).filter(p => p.qty > 0);
  const ranked = positions.map(p => ({
    symbol_id: p.symbol_id, name: p.name, code: p.code, category: p.category,
    float: p.float_pnl, pnl_pct: p.pnl_pct
  })).sort((a, b) => (b.float || 0) - (a.float || 0));
  res.json({ code: 0, data: { profit: ranked.filter(r => (r.float || 0) > 0), loss: ranked.filter(r => (r.float || 0) < 0) } });
});

router.get('/trend', (req, res) => {
  res.json({ code: 0, data: portfolio.pnlByPeriod(req.user.id) });
});

router.get('/discipline', (req, res) => {
  const { from, to } = req.query;
  const start = from ? new Date(from).getTime() : null;
  let end = to ? new Date(to) : null;
  if (end && String(to).length <= 10) end.setHours(23, 59, 59, 999);
  res.json({ code: 0, data: portfolio.computeDiscipline(req.user.id, start, end ? end.getTime() : null) });
});

module.exports = router;
