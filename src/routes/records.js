// src/routes/records.js - 账户 / 标的 / 交易记录 / 市价 / 行情
const express = require('express');
const db = require('../db');
const router = express.Router();

const uid = (req) => req.user.id;
const CATS = ['stock', 'fund', 'future', 'bond', 'other'];
const ACTIONS = ['open', 'add', 'reduce', 'close', 'dividend', 'fee'];

function sinaSymbol(code, market) {
  const raw = String(code || '').trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (market === 'SH') return 'sh' + (digits || raw).padStart(6, '0');
  if (market === 'SZ') return 'sz' + (digits || raw).padStart(6, '0');
  if (market === 'HK') {
    const hk = raw.replace(/^HK/i, '').replace(/\D/g, '') || raw;
    return 'hk' + String(hk).padStart(5, '0');
  }
  if (market === 'US') return 'gb_' + raw.toLowerCase();
  if (market === 'FUND' || market === 'JJ') return 'f_' + (digits || raw);
  return null;
}

async function fetchStockSearch(keyword) {
  if (!keyword || keyword.length < 1) return [];
  try {
    const url = 'https://smartbox.gtimg.cn/s3/?q=' + encodeURIComponent(keyword) + '&t=all&c=1';
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const text = await res.text();
    const match = text.match(/v_hint="([^"]*)"/);
    if (!match || !match[1]) return [];
    return match[1].split('^').map(item => {
      const parts = item.split('~');
      if (parts.length < 3) return null;
      const marketRaw = (parts[0] || '').toLowerCase();
      const code = parts[1] || '';
      const name = parts[2] || '';
      const typeCode = parts[4] || '';
      let market = '', category = 'stock';
      if (marketRaw === 'sh') market = 'SH';
      else if (marketRaw === 'sz') market = 'SZ';
      else if (marketRaw === 'hk') market = 'HK';
      else if (marketRaw === 'us') market = 'US';
      else if (marketRaw === 'jj') { market = 'FUND'; category = 'fund'; }
      if (typeCode.includes('ETF') || typeCode.includes('LOF')) category = 'fund';
      else if (typeCode.includes('KJ')) category = 'bond';
      else if (typeCode.includes('QZ')) category = 'other';
      return { code, name, market, category };
    }).filter(s => s && s.name && s.code);
  } catch (e) {
    console.error('[stock-search]', e.message);
    return [];
  }
}

async function trySina(symbol) {
  const url = 'https://hq.sinajs.cn/list=' + symbol;
  const res = await fetch(url, {
    headers: { Referer: 'https://finance.sina.com.cn/' },
    signal: AbortSignal.timeout(5000)
  });
  const text = await res.text();
  const match = text.match(/="([^"]+)"/);
  if (!match || !match[1] || match[1] === 'FAILED') return null;
  const fields = match[1].split(',');
  const price = parseFloat(
    symbol.startsWith('hk') ? fields[6]
      : symbol.startsWith('gb_') ? fields[1]
        : symbol.startsWith('f_') ? fields[1]
          : fields[3]
  );
  const name = fields[0] || '';
  return isNaN(price) || price <= 0 ? null : { price, name, raw: symbol };
}

async function fetchRealtimePrice(code, market) {
  try {
    const tries = [];
    const primary = sinaSymbol(code, market);
    if (primary) tries.push(primary);
    if (!primary && /^\d{6}$/.test(String(code))) {
      const c = String(code);
      tries.push((c.startsWith('6') || c.startsWith('9') ? 'sh' : 'sz') + c);
    }
    const digits = String(code || '').replace(/\D/g, '');
    if (digits.length >= 6) {
      const fund = 'f_' + digits;
      if (!tries.includes(fund)) tries.push(fund);
    }
    for (const symbol of tries) {
      const quote = await trySina(symbol);
      if (quote) return quote;
    }
    return null;
  } catch (e) {
    console.error('[realtime-price]', e.message);
    return null;
  }
}

function resolveSymbolId(userId, b) {
  const { account_id, symbol_id, symbol_name, symbol_code, category, market, direction, multiplier } = b;
  let sid = symbol_id ? parseInt(symbol_id, 10) : null;
  const code = (symbol_code || '').trim();
  const name = (symbol_name || '').trim();
  const cat = category || 'stock';

  if (sid) {
    const sym = db.prepare('SELECT id FROM symbols WHERE id = ? AND user_id = ?').get(sid, userId);
    if (!sym) return { error: '标的不存在' };
    if (code || market) {
      db.prepare('UPDATE symbols SET code = COALESCE(NULLIF(?, ""), code), market = COALESCE(NULLIF(?, ""), market) WHERE id = ? AND user_id = ?')
        .run(code, market || '', sid, userId);
    }
    return { sid };
  }

  if (code) {
    const byCode = db.prepare('SELECT id FROM symbols WHERE user_id = ? AND code = ? AND category = ?').get(userId, code, cat);
    if (byCode) {
      if (name) db.prepare('UPDATE symbols SET name = ?, market = COALESCE(NULLIF(?, ""), market) WHERE id = ?').run(name, market || '', byCode.id);
      return { sid: byCode.id };
    }
  }
  if (name) {
    if (!CATS.includes(cat)) return { error: '分类必填且需为 stock/fund/future/bond/other' };
    const existing = db.prepare('SELECT id FROM symbols WHERE user_id = ? AND name = ? AND category = ?')
      .get(userId, name, cat);
    if (existing) {
      if (code || market) {
        db.prepare('UPDATE symbols SET code = COALESCE(NULLIF(?, ""), code), market = COALESCE(NULLIF(?, ""), market) WHERE id = ?')
          .run(code, market || '', existing.id);
      }
      return { sid: existing.id };
    }
    const info = db.prepare(`INSERT INTO symbols (user_id, category, code, name, market, direction, multiplier, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, cat, code, name, market || '', direction || 'long', multiplier ? parseFloat(multiplier) : 1, Date.now());
    return { sid: info.lastInsertRowid };
  }
  return { error: '标的不存在，请输入标的名称' };
}

router.get('/symbols/search', async (req, res) => {
  const { q, cat } = req.query;
  if (!q || q.trim().length < 1) return res.json({ code: 0, data: [] });
  const results = await fetchStockSearch(q.trim());
  const filtered = cat ? results.filter(r => r.category === cat) : results;
  res.json({ code: 0, data: filtered.slice(0, 15) });
});

router.get('/prices/realtime', async (req, res) => {
  const { code, market } = req.query;
  if (!code) return res.status(400).json({ code: 1, message: '缺少股票代码' });
  const quote = await fetchRealtimePrice(code, market || '');
  if (!quote) return res.json({ code: 0, data: { price: null, error: '未获取到行情数据' } });
  res.json({ code: 0, data: { price: quote.price, name: quote.name } });
});

router.post('/prices/refresh', async (req, res) => {
  const userId = uid(req);
  const { seedDefaultSymbols } = require('../db');
  seedDefaultSymbols(userId);
  const positions = require('../portfolio').computePositions(userId).filter(p => p.qty > 0 && p.code);
  const updated = [];
  const failed = [];
  for (const p of positions) {
    const quote = await fetchRealtimePrice(p.code, p.market || '');
    if (quote && quote.price != null) {
      db.prepare(`INSERT INTO market_prices (user_id, symbol_id, price, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, symbol_id) DO UPDATE SET price = excluded.price, updated_at = excluded.updated_at`)
        .run(userId, p.symbol_id, quote.price, Date.now());
      updated.push({ symbol_id: p.symbol_id, name: p.name, price: quote.price });
    } else {
      failed.push({ symbol_id: p.symbol_id, name: p.name, code: p.code });
    }
  }
  res.json({ code: 0, data: { updated, failed, count: updated.length } });
});

// ---------- 账户 ----------
router.get('/accounts', (req, res) => {
  const { seedDefaultAccount } = require('../db');
  seedDefaultAccount(uid(req));
  const rows = db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY created_at DESC').all(uid(req));
  res.json({ code: 0, data: rows });
});
router.post('/accounts', (req, res) => {
  const { name, broker, type } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ code: 1, message: '账户名称必填' });
  const info = db.prepare('INSERT INTO accounts (user_id, name, broker, type, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(uid(req), String(name).trim(), broker || '', type || '', Date.now());
  res.json({ code: 0, data: { id: info.lastInsertRowid } });
});
router.put('/accounts/:id', (req, res) => {
  const { name, broker, type } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ code: 1, message: '账户名称必填' });
  db.prepare('UPDATE accounts SET name = ?, broker = ?, type = ? WHERE id = ? AND user_id = ?')
    .run(String(name).trim(), broker || '', type || '', req.params.id, uid(req));
  res.json({ code: 0 });
});
router.delete('/accounts/:id', (req, res) => {
  db.prepare('DELETE FROM accounts WHERE id = ? AND user_id = ?').run(req.params.id, uid(req));
  res.json({ code: 0 });
});

// ---------- 标的 ----------
router.get('/symbols', (req, res) => {
  const { seedDefaultSymbols } = require('../db');
  seedDefaultSymbols(uid(req));
  const rows = db.prepare('SELECT * FROM symbols WHERE user_id = ? ORDER BY category, created_at').all(uid(req));
  res.json({ code: 0, data: rows });
});
router.post('/symbols', (req, res) => {
  const { category, code, name, market, direction, leverage, multiplier, extra } = req.body || {};
  if (!name || !CATS.includes(category))
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

function tradeSelectSql() {
  return `SELECT t.*, s.name AS symbol_name, s.category, s.code AS symbol_code, s.market AS symbol_market,
             a.name AS account_name
      FROM trades t
      JOIN symbols s ON s.id = t.symbol_id
      LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.user_id = ?`;
}

router.get('/trades', (req, res) => {
  const { symbol_id, category, limit, offset, q, from, to, account_id } = req.query;
  let sql = tradeSelectSql();
  const params = [uid(req)];
  if (symbol_id) { sql += ' AND t.symbol_id = ?'; params.push(symbol_id); }
  if (account_id) { sql += ' AND t.account_id = ?'; params.push(account_id); }
  if (category) { sql += ' AND s.category = ?'; params.push(category); }
  if (q) { sql += ' AND (s.name LIKE ? OR s.code LIKE ? OR IFNULL(t.note,"") LIKE ?)'; const like = '%' + q + '%'; params.push(like, like, like); }
  if (from) { sql += ' AND t.datetime >= ?'; params.push(new Date(from).getTime()); }
  if (to) {
    const end = new Date(to);
    if (String(to).length <= 10) end.setHours(23, 59, 59, 999);
    sql += ' AND t.datetime <= ?';
    params.push(end.getTime());
  }
  sql += ' ORDER BY t.datetime DESC, t.id DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit, 10)); }
  if (offset) { sql += ' OFFSET ?'; params.push(parseInt(offset, 10)); }
  const rows = db.prepare(sql).all(...params);
  res.json({ code: 0, data: rows });
});

function parseTradeBody(b) {
  const { action, side, quantity, price, fee, datetime, note, account_id } = b;
  if (!ACTIONS.includes(action)) return { error: '动作类型必填且合法' };
  if (!['buy', 'sell'].includes(side)) return { error: '方向需为 buy/sell' };
  const q = parseFloat(quantity); const p = parseFloat(price);
  if (!(q > 0) || !(p >= 0)) return { error: '数量价格非法' };
  return {
    action, side, q, p, amount: q * p,
    fee: parseFloat(fee || 0) || 0,
    datetime: new Date(datetime || Date.now()).getTime(),
    note: note || '',
    account_id: account_id ? parseInt(account_id, 10) : null
  };
}

router.post('/trades', (req, res) => {
  const b = req.body || {};
  const parsed = parseTradeBody(b);
  if (parsed.error) return res.status(400).json({ code: 1, message: parsed.error });
  const resolved = resolveSymbolId(uid(req), b);
  if (resolved.error) return res.status(400).json({ code: 1, message: resolved.error });
  if (parsed.account_id) {
    const acc = db.prepare('SELECT id FROM accounts WHERE id = ? AND user_id = ?').get(parsed.account_id, uid(req));
    if (!acc) return res.status(400).json({ code: 1, message: '账户不存在' });
  }
  const info = db.prepare(`INSERT INTO trades
    (user_id, account_id, symbol_id, action, side, quantity, price, amount, fee, datetime, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(uid(req), parsed.account_id, resolved.sid, parsed.action, parsed.side, parsed.q, parsed.p, parsed.amount,
      parsed.fee, parsed.datetime, parsed.note, Date.now());
  res.json({ code: 0, data: { id: info.lastInsertRowid } });
});

router.put('/trades/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM trades WHERE id = ? AND user_id = ?').get(req.params.id, uid(req));
  if (!row) return res.status(404).json({ code: 1, message: '交易不存在' });
  const b = { ...row, ...(req.body || {}) };
  if (!b.symbol_name && b.symbol_id) {
    const s = db.prepare('SELECT name, category, code, market FROM symbols WHERE id = ?').get(b.symbol_id);
    if (s) {
      b.symbol_name = b.symbol_name || s.name;
      b.category = b.category || s.category;
      b.symbol_code = b.symbol_code || s.code;
      b.market = b.market || s.market;
    }
  }
  const parsed = parseTradeBody(b);
  if (parsed.error) return res.status(400).json({ code: 1, message: parsed.error });
  const resolved = resolveSymbolId(uid(req), b);
  if (resolved.error) return res.status(400).json({ code: 1, message: resolved.error });
  db.prepare(`UPDATE trades SET account_id=?, symbol_id=?, action=?, side=?, quantity=?, price=?, amount=?, fee=?, datetime=?, note=?
    WHERE id=? AND user_id=?`)
    .run(parsed.account_id, resolved.sid, parsed.action, parsed.side, parsed.q, parsed.p, parsed.amount,
      parsed.fee, parsed.datetime, parsed.note, req.params.id, uid(req));
  res.json({ code: 0 });
});

router.get('/trades/:id', (req, res) => {
  const row = db.prepare(tradeSelectSql() + ' AND t.id = ?').get(uid(req), req.params.id);
  if (!row) return res.status(404).json({ code: 1, message: '交易不存在' });
  res.json({ code: 0, data: row });
});

router.delete('/trades/:id', (req, res) => {
  db.prepare('DELETE FROM trades WHERE id = ? AND user_id = ?').run(req.params.id, uid(req));
  res.json({ code: 0 });
});

router.put('/prices/:symbol_id', (req, res) => {
  const price = parseFloat(req.body && req.body.price);
  if (!(price >= 0)) return res.status(400).json({ code: 1, message: '价格非法' });
  const sid = req.params.symbol_id;
  const sym = db.prepare('SELECT id FROM symbols WHERE id = ? AND user_id = ?').get(sid, uid(req));
  if (!sym) return res.status(400).json({ code: 1, message: '标的不存在' });
  db.prepare(`INSERT INTO market_prices (user_id, symbol_id, price, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, symbol_id) DO UPDATE SET price = excluded.price, updated_at = excluded.updated_at`)
    .run(uid(req), sid, price, Date.now());
  res.json({ code: 0 });
});

module.exports = router;
