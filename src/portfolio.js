// src/portfolio.js - 持仓与盈亏计算
const db = require('./db');

// 计算某用户所有标的的持仓与浮动盈亏
function computePositions(userId) {
  const trades = db.prepare(`
    SELECT t.*, s.category, s.name, s.code, s.direction, s.multiplier, s.market
    FROM trades t JOIN symbols s ON s.id = t.symbol_id
    WHERE t.user_id = ? ORDER BY t.datetime ASC
  `).all(userId);

  const priceRows = db.prepare('SELECT symbol_id, price FROM market_prices WHERE user_id = ?').all(userId);
  const prices = {};
  priceRows.forEach(r => { prices[r.symbol_id] = r.price; });

  const posMap = {};
  for (const t of trades) {
    const key = t.symbol_id;
    if (!posMap[key]) {
      posMap[key] = {
        symbol_id: t.symbol_id, name: t.name, code: t.code, category: t.category,
        market: t.market, direction: t.direction, multiplier: t.multiplier || 1,
        qty: 0, cost: 0, avg_cost: 0, realized: 0
      };
    }
    const p = posMap[key];
    const sign = (p.direction === 'short') ? -1 : 1;
    if (t.side === 'buy') {
      const add = t.amount + (t.fee || 0);
      p.cost += add;
      p.qty += t.quantity;
    } else { // sell
      const avg = p.qty > 0 ? p.cost / p.qty : 0;
      const soldCost = avg * t.quantity;
      const proceeds = t.amount - (t.fee || 0);
      p.realized += (proceeds - soldCost);
      p.qty -= t.quantity;
      p.cost -= soldCost;
    }
    if (p.qty < 1e-9) { p.qty = 0; p.cost = 0; }
    p.avg_cost = p.qty > 0 ? p.cost / p.qty : 0;
  }

  const result = [];
  for (const p of Object.values(posMap)) {
    const mp = prices[p.symbol_id];
    const mult = p.multiplier || 1;
    const sign = (p.direction === 'short') ? -1 : 1;
    let market_value = 0, float_pnl = null;
    if (mp != null) {
      market_value = mp * p.qty * mult * sign > 0 ? mp * p.qty * mult : mp * p.qty * mult;
      // 期货空单市值为负方向，统一用 (市价-成本)*数量*乘数*方向
      market_value = mp * p.qty * mult;
      float_pnl = (mp - p.avg_cost) * p.qty * mult * sign;
    }
    result.push({
      symbol_id: p.symbol_id, name: p.name, code: p.code, category: p.category,
      market: p.market, direction: p.direction, multiplier: mult,
      qty: p.qty, avg_cost: p.avg_cost, market_price: mp != null ? mp : null,
      market_value, float_pnl, realized: p.realized
    });
  }
  return result;
}

// 总体统计
function computeOverview(userId) {
  const positions = computePositions(userId);
  let total_cost = 0, total_market = 0, total_realized = 0, total_float = 0;
  let invested = 0;
  for (const p of positions) {
    total_realized += p.realized || 0;
    if (p.qty > 0) {
      total_cost += p.avg_cost * p.qty * (p.multiplier || 1);
      if (p.market_price != null) {
        total_market += p.market_value;
        total_float += p.float_pnl;
      }
      invested += p.avg_cost * p.qty * (p.multiplier || 1);
    }
  }
  const total_pnl = total_realized + total_float;
  const total_return = invested > 0 ? (total_pnl / invested) * 100 : 0;
  return {
    positions_count: positions.filter(p => p.qty > 0).length,
    invested: Math.round(invested * 100) / 100,
    market_value: Math.round(total_market * 100) / 100,
    realized: Math.round(total_realized * 100) / 100,
    float_pnl: Math.round(total_float * 100) / 100,
    total_pnl: Math.round(total_pnl * 100) / 100,
    total_return: Math.round(total_return * 100) / 100
  };
}

// 按时间（月）汇总已实现盈亏曲线
function pnlByPeriod(userId) {
  const rows = db.prepare(`
    SELECT datetime, side, amount, fee, quantity, symbol_id FROM trades
    WHERE user_id = ? ORDER BY datetime ASC
  `).all(userId);
  const symbols = db.prepare('SELECT id, direction, multiplier FROM symbols WHERE user_id = ?').all(userId);
  const symMap = {};
  symbols.forEach(s => { symMap[s.id] = s; });

  // 重建每标的成本以算已实现
  const costMap = {};
  const monthly = {};
  for (const t of rows) {
    const s = symMap[t.symbol_id] || { direction: 'long', multiplier: 1 };
    const mult = s.multiplier || 1;
    const key = new Date(t.datetime).toISOString().slice(0, 7); // YYYY-MM
    if (!monthly[key]) monthly[key] = 0;
    if (!costMap[t.symbol_id]) costMap[t.symbol_id] = { qty: 0, cost: 0 };
    const c = costMap[t.symbol_id];
    if (t.side === 'buy') {
      c.cost += t.amount + (t.fee || 0);
      c.qty += t.quantity;
    } else {
      const avg = c.qty > 0 ? c.cost / c.qty : 0;
      const soldCost = avg * t.quantity;
      const proceeds = t.amount - (t.fee || 0);
      monthly[key] += (proceeds - soldCost);
      c.qty -= t.quantity;
      c.cost -= soldCost;
      if (c.qty < 1e-9) { c.qty = 0; c.cost = 0; }
    }
  }
  const labels = Object.keys(monthly).sort();
  return { labels, values: labels.map(l => Math.round(monthly[l] * 100) / 100) };
}

module.exports = { computePositions, computeOverview, pnlByPeriod };
