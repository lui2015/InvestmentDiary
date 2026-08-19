// src/portfolio.js - 持仓与盈亏计算
const db = require('./db');

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// 计算某用户所有标的的持仓与浮动盈亏
function computePositions(userId) {
  const trades = db.prepare(`
    SELECT t.*, s.category, s.name, s.code, s.direction, s.multiplier, s.market
    FROM trades t JOIN symbols s ON s.id = t.symbol_id
    WHERE t.user_id = ? ORDER BY t.datetime ASC, t.id ASC
  `).all(userId);

  const priceRows = db.prepare('SELECT symbol_id, price, updated_at FROM market_prices WHERE user_id = ?').all(userId);
  const prices = {};
  const priceAt = {};
  priceRows.forEach(r => { prices[r.symbol_id] = r.price; priceAt[r.symbol_id] = r.updated_at; });

  const posMap = {};
  for (const t of trades) {
    const key = t.symbol_id;
    if (!posMap[key]) {
      posMap[key] = {
        symbol_id: t.symbol_id, name: t.name, code: t.code, category: t.category,
        market: t.market, direction: t.direction, multiplier: t.multiplier || 1,
        qty: 0, cost: 0, avg_cost: 0, realized: 0, buy_amount: 0, sell_amount: 0, trade_count: 0
      };
    }
    const p = posMap[key];
    p.trade_count += 1;
    if (t.side === 'buy') {
      const add = t.amount + (t.fee || 0);
      p.cost += add;
      p.qty += t.quantity;
      p.buy_amount += t.amount;
    } else {
      const avg = p.qty > 0 ? p.cost / p.qty : 0;
      const soldCost = avg * t.quantity;
      const proceeds = t.amount - (t.fee || 0);
      p.realized += (proceeds - soldCost);
      p.qty -= t.quantity;
      p.cost -= soldCost;
      p.sell_amount += t.amount;
    }
    if (p.qty < 1e-9) { p.qty = 0; p.cost = 0; }
    p.avg_cost = p.qty > 0 ? p.cost / p.qty : 0;
  }

  const result = [];
  for (const p of Object.values(posMap)) {
    const mp = prices[p.symbol_id];
    const mult = p.multiplier || 1;
    const sign = (p.direction === 'short') ? -1 : 1;
    let market_value = 0, float_pnl = null, pnl_pct = null;
    if (mp != null) {
      market_value = mp * p.qty * mult;
      float_pnl = (mp - p.avg_cost) * p.qty * mult * sign;
      if (p.avg_cost > 0 && p.qty > 0) {
        pnl_pct = ((mp - p.avg_cost) / p.avg_cost) * 100 * sign;
      }
    }
    result.push({
      symbol_id: p.symbol_id, name: p.name, code: p.code, category: p.category,
      market: p.market, direction: p.direction, multiplier: mult,
      qty: p.qty, avg_cost: round2(p.avg_cost),
      market_price: mp != null ? mp : null,
      price_updated_at: priceAt[p.symbol_id] || null,
      market_value: round2(market_value),
      float_pnl: float_pnl == null ? null : round2(float_pnl),
      pnl_pct: pnl_pct == null ? null : round2(pnl_pct),
      realized: round2(p.realized),
      trade_count: p.trade_count
    });
  }
  return result;
}

// 总体统计
function computeOverview(userId) {
  const positions = computePositions(userId);
  let total_cost = 0, total_market = 0, total_realized = 0, total_float = 0;
  let invested = 0, priced = 0;
  for (const p of positions) {
    total_realized += p.realized || 0;
    if (p.qty > 0) {
      total_cost += p.avg_cost * p.qty * (p.multiplier || 1);
      if (p.market_price != null) {
        total_market += p.market_value;
        total_float += p.float_pnl;
        priced += 1;
      }
      invested += p.avg_cost * p.qty * (p.multiplier || 1);
    }
  }
  const total_pnl = total_realized + total_float;
  const total_return = invested > 0 ? (total_pnl / invested) * 100 : 0;
  const holdCount = positions.filter(p => p.qty > 0).length;
  return {
    positions_count: holdCount,
    priced_count: priced,
    missing_price_count: Math.max(0, holdCount - priced),
    invested: round2(invested),
    market_value: round2(total_market),
    realized: round2(total_realized),
    float_pnl: round2(total_float),
    total_pnl: round2(total_pnl),
    total_return: round2(total_return)
  };
}

// 按月汇总已实现盈亏，并给出累计曲线
function pnlByPeriod(userId) {
  const rows = db.prepare(`
    SELECT datetime, side, amount, fee, quantity, symbol_id FROM trades
    WHERE user_id = ? ORDER BY datetime ASC, id ASC
  `).all(userId);

  const costMap = {};
  const monthly = {};
  for (const t of rows) {
    const key = new Date(t.datetime).toISOString().slice(0, 7);
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
  const values = labels.map(l => round2(monthly[l]));
  let acc = 0;
  const cumulative = values.map(v => { acc += v; return round2(acc); });
  return { labels, values, cumulative };
}

// 卖出片段胜率 / 盈亏比等纪律指标
function computeDiscipline(userId, start, end) {
  let sql = `SELECT datetime, side, amount, fee, quantity, symbol_id FROM trades WHERE user_id = ?`;
  const params = [userId];
  sql += ' ORDER BY datetime ASC, id ASC';
  const rows = db.prepare(sql).all(...params);
  const costMap = {};
  let winCount = 0, lossCount = 0, winAmt = 0, lossAmt = 0, sellCount = 0;
  let buyCount = 0, buyAmount = 0, sellAmount = 0;
  const closed = [];

  for (const t of rows) {
    if (start && t.datetime < start) {
      // 仍要走成本，以便区间内卖出能算出盈亏
    }
    if (!costMap[t.symbol_id]) costMap[t.symbol_id] = { qty: 0, cost: 0 };
    const c = costMap[t.symbol_id];
    const inRange = (!start || t.datetime >= start) && (!end || t.datetime <= end);
    if (t.side === 'buy') {
      c.cost += t.amount + (t.fee || 0);
      c.qty += t.quantity;
      if (inRange) { buyCount += 1; buyAmount += t.amount; }
    } else {
      const avg = c.qty > 0 ? c.cost / c.qty : 0;
      const soldCost = avg * t.quantity;
      const proceeds = t.amount - (t.fee || 0);
      const pnl = proceeds - soldCost;
      c.qty -= t.quantity;
      c.cost -= soldCost;
      if (c.qty < 1e-9) { c.qty = 0; c.cost = 0; }
      if (inRange) {
        sellCount += 1;
        sellAmount += t.amount;
        closed.push(pnl);
        if (pnl >= 0) { winCount += 1; winAmt += pnl; }
        else { lossCount += 1; lossAmt += pnl; }
      }
    }
  }

  const closedCount = winCount + lossCount;
  const win_rate = closedCount > 0 ? round2((winCount / closedCount) * 100) : null;
  const profit_factor = lossAmt < 0 ? round2(winAmt / Math.abs(lossAmt)) : (winAmt > 0 ? 99 : null);
  return {
    buy_count: buyCount,
    sell_count: sellCount,
    buy_amount: round2(buyAmount),
    sell_amount: round2(sellAmount),
    win_count: winCount,
    loss_count: lossCount,
    win_rate,
    avg_win: winCount ? round2(winAmt / winCount) : 0,
    avg_loss: lossCount ? round2(lossAmt / lossCount) : 0,
    profit_factor,
    realized: round2(winAmt + lossAmt)
  };
}

function periodInsight(userId, start, end) {
  const trades = db.prepare(`
    SELECT t.*, s.name AS symbol_name, s.code AS symbol_code, s.category,
           a.name AS account_name
    FROM trades t
    JOIN symbols s ON s.id = t.symbol_id
    LEFT JOIN accounts a ON a.id = t.account_id
    WHERE t.user_id = ? AND t.datetime >= ? AND t.datetime <= ?
    ORDER BY t.datetime ASC, t.id ASC
  `).all(userId, start, end);
  const discipline = computeDiscipline(userId, start, end);
  return { trades, discipline };
}

module.exports = { computePositions, computeOverview, pnlByPeriod, computeDiscipline, periodInsight };
