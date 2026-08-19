// src/routes/pref.js - 用户偏好（主题等）与备份
const express = require('express');
const db = require('../db');
const router = express.Router();

const THEMES = ['light', 'dark', 'cyberpunk', 'comic', 'auto'];

router.get('/', (req, res) => {
  const row = db.prepare('SELECT theme FROM user_prefs WHERE user_id = ?').get(req.user.id);
  res.json({ code: 0, data: { theme: row ? row.theme : 'dark', themes: THEMES } });
});
router.put('/theme', (req, res) => {
  const { theme } = req.body || {};
  if (!THEMES.includes(theme)) return res.status(400).json({ code: 1, message: '主题不合法' });
  db.prepare(`INSERT INTO user_prefs (user_id, theme, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET theme = excluded.theme, updated_at = excluded.updated_at`)
    .run(req.user.id, theme, Date.now());
  res.json({ code: 0, data: { theme } });
});

router.get('/export', (req, res) => {
  const u = req.user.id;
  const data = {
    exported_at: new Date().toISOString(),
    user: db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(u),
    accounts: db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(u),
    symbols: db.prepare('SELECT * FROM symbols WHERE user_id = ?').all(u),
    trades: db.prepare('SELECT * FROM trades WHERE user_id = ?').all(u),
    market_prices: db.prepare('SELECT * FROM market_prices WHERE user_id = ?').all(u),
    alert_rules: db.prepare('SELECT * FROM alert_rules WHERE user_id = ?').all(u),
    reviews: db.prepare('SELECT * FROM reviews WHERE user_id = ?').all(u)
  };
  res.setHeader('Content-Disposition', 'attachment; filename="investment-diary-export.json"');
  res.json({ code: 0, data });
});

router.get('/export.csv', (req, res) => {
  const u = req.user.id;
  const rows = db.prepare(`
    SELECT t.datetime, s.category, s.code, s.name AS symbol_name, a.name AS account_name,
           t.action, t.side, t.quantity, t.price, t.amount, t.fee, t.note
    FROM trades t
    JOIN symbols s ON s.id = t.symbol_id
    LEFT JOIN accounts a ON a.id = t.account_id
    WHERE t.user_id = ?
    ORDER BY t.datetime DESC
  `).all(u);
  const header = ['时间', '品类', '代码', '名称', '账户', '动作', '方向', '数量', '价格', '金额', '手续费', '备注'];
  const cat = { stock: '股票', fund: '基金', future: '期货', bond: '债券', other: '其他' };
  const act = { open: '开仓', add: '加仓', reduce: '减仓', close: '平仓', dividend: '分红', fee: '费用' };
  const csvEscape = (v) => {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      new Date(r.datetime).toISOString(),
      cat[r.category] || r.category,
      r.code, r.symbol_name, r.account_name || '',
      act[r.action] || r.action,
      r.side === 'buy' ? '买' : '卖',
      r.quantity, r.price, r.amount, r.fee, r.note
    ].map(csvEscape).join(','));
  }
  const bom = '\uFEFF';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="investment-trades.csv"');
  res.send(bom + lines.join('\n'));
});

router.post('/import', (req, res) => {
  const payload = (req.body && (req.body.data || req.body)) || {};
  const accounts = payload.accounts || [];
  const symbols = payload.symbols || [];
  const trades = payload.trades || [];
  const prices = payload.market_prices || [];
  const rules = payload.alert_rules || [];
  const reviews = payload.reviews || [];
  if (!symbols.length && !trades.length) {
    return res.status(400).json({ code: 1, message: '导入文件缺少交易或标的数据' });
  }
  const u = req.user.id;
  const now = Date.now();
  const accMap = {};
  const symMap = {};
  const tx = db.transaction(() => {
    for (const a of accounts) {
      const info = db.prepare('INSERT INTO accounts (user_id, name, broker, type, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(u, a.name || '导入账户', a.broker || '', a.type || '', a.created_at || now);
      accMap[a.id] = info.lastInsertRowid;
    }
    for (const s of symbols) {
      const info = db.prepare(`INSERT INTO symbols (user_id, category, code, name, market, direction, leverage, multiplier, extra, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(u, s.category || 'stock', s.code || '', s.name || '未命名', s.market || '',
          s.direction || 'long', s.leverage || null, s.multiplier || 1, s.extra || null, s.created_at || now);
      symMap[s.id] = info.lastInsertRowid;
    }
    for (const t of trades) {
      const sid = t.symbol_id != null ? symMap[t.symbol_id] : null;
      if (!sid) continue;
      db.prepare(`INSERT INTO trades (user_id, account_id, symbol_id, action, side, quantity, price, amount, fee, datetime, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(u, t.account_id != null ? (accMap[t.account_id] || null) : null, sid,
          t.action, t.side, t.quantity, t.price, t.amount, t.fee || 0, t.datetime, t.note || '', t.created_at || now);
    }
    for (const p of prices) {
      const sid = p.symbol_id != null ? symMap[p.symbol_id] : null;
      if (!sid || p.price == null) continue;
      db.prepare(`INSERT INTO market_prices (user_id, symbol_id, price, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, symbol_id) DO UPDATE SET price = excluded.price, updated_at = excluded.updated_at`)
        .run(u, sid, p.price, p.updated_at || now);
    }
    for (const r of rules) {
      const sid = r.symbol_id != null ? symMap[r.symbol_id] : null;
      if (!sid) continue;
      db.prepare(`INSERT INTO alert_rules (user_id, symbol_id, type, mode, threshold, status, last_triggered, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(u, sid, r.type, r.mode, r.threshold, r.status || 'active', r.last_triggered || null, r.created_at || now);
    }
    for (const r of reviews) {
      const content = typeof r.content === 'string' ? r.content : JSON.stringify(r.content || {});
      db.prepare(`INSERT INTO reviews (user_id, period_type, start_date, end_date, content, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(u, r.period_type || 'custom', r.start_date, r.end_date, content, r.created_at || now);
    }
  });
  tx();
  res.json({
    code: 0,
    data: {
      accounts: accounts.length, symbols: symbols.length, trades: trades.length,
      prices: prices.length, rules: rules.length, reviews: reviews.length
    }
  });
});

module.exports = router;
