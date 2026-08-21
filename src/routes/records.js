// src/routes/records.js - 账户 / 标的 / 交易记录 / 市价 / 行情
const express = require('express');
const db = require('../db');
const router = express.Router();

const uid = (req) => req.user && req.user.id;
const CATS = ['stock', 'fund', 'future', 'bond', 'other'];
const ACTIONS = ['open', 'add', 'reduce', 'close', 'dividend', 'fee'];
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const EM_TOKEN = 'FAKESECRET_k3l4m5n6o7p8q9r0s1t2';

async function httpText(url, referer) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      Referer: referer || 'https://www.eastmoney.com/',
      Accept: '*/*'
    },
    signal: AbortSignal.timeout(6000)
  });
  return res.text();
}

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

function mapQuoteId(quoteId, typeName, classify) {
  let market = 'SH';
  let category = 'stock';
  const qid = String(quoteId || '');
  const tn = typeName || '';
  const cl = (classify || '').toLowerCase();
  if (qid.startsWith('1.')) market = 'SH';
  else if (qid.startsWith('0.')) market = 'SZ';
  else if (qid.startsWith('116.') || qid.startsWith('128.') || qid.startsWith('151.')) market = 'HK';
  else if (qid.startsWith('105.') || qid.startsWith('106.') || qid.startsWith('107.')) market = 'US';
  if (cl.includes('fund') || /基金|ETF|LOF/.test(tn)) category = 'fund';
  else if (cl.includes('bond') || /债/.test(tn)) category = 'bond';
  else if (cl.includes('future') || /期货/.test(tn)) category = 'future';
  else if (/港/.test(tn)) { category = 'stock'; market = 'HK'; }
  else if (/美/.test(tn)) { category = 'stock'; market = 'US'; }
  return { market, category };
}

function parseExtra(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}

async function searchEastMoney(keyword) {
  const url = 'https://searchapi.eastmoney.com/api/suggest/get?input=' +
    encodeURIComponent(keyword) + '&type=14&token=' + EM_TOKEN + '&count=12';
  const text = await httpText(url, 'https://www.eastmoney.com/');
  let json;
  try { json = JSON.parse(text); } catch { return []; }
  const rows = (json.QuotationCodeTable && json.QuotationCodeTable.Data) || [];
  return rows.map(item => {
    const cl = item.Classify || '';
    if (cl === 'NEEQ' || cl === 'Index') return null;
    const mapped = mapQuoteId(item.QuoteID, item.SecurityTypeName, cl);
    const code = String(item.Code || item.UnifiedCode || '').trim();
    const name = String(item.Name || '').trim();
    if (!code || !name) return null;
    return {
      code, name, market: mapped.market, category: mapped.category,
      quote_id: item.QuoteID || '', source: 'eastmoney',
      type_name: item.SecurityTypeName || labelByCat(mapped.category)
    };
  }).filter(Boolean);
}

async function searchTencent(keyword) {
  const url = 'https://smartbox.gtimg.cn/s3/?q=' + encodeURIComponent(keyword) + '&t=all&c=1';
  const text = await httpText(url, 'https://stockapp.finance.qq.com/');
  const match = text.match(/v_hint="([^"]*)"/);
  if (!match || !match[1]) return [];
  return match[1].split('^').map(item => {
    const parts = item.split('~');
    if (parts.length < 3) return null;
    const marketRaw = (parts[0] || '').toLowerCase();
    const code = parts[1] || '';
    const name = parts[2] || '';
    const typeCode = parts[4] || '';
    let market = 'SH', category = 'stock', quote_id = '';
    if (marketRaw === 'sh') { market = 'SH'; quote_id = '1.' + code; }
    else if (marketRaw === 'sz') { market = 'SZ'; quote_id = '0.' + code; }
    else if (marketRaw === 'hk') { market = 'HK'; quote_id = '116.' + code; }
    else if (marketRaw === 'us') { market = 'US'; }
    else if (marketRaw === 'jj') { market = 'FUND'; category = 'fund'; }
    if (typeCode.includes('ETF') || typeCode.includes('LOF')) category = 'fund';
    else if (typeCode.includes('KJ')) category = 'bond';
    else if (typeCode.includes('QZ')) category = 'other';
    return { code, name, market, category, quote_id, source: 'tencent', type_name: '' };
  }).filter(s => s && s.name && s.code);
}

function searchLocal(userId, keyword) {
  if (!userId) return [];
  const like = '%' + keyword + '%';
  return db.prepare(`
    SELECT id AS symbol_id, code, name, market, category, extra
    FROM symbols WHERE user_id = ? AND (name LIKE ? OR code LIKE ?)
    ORDER BY name LIMIT 8
  `).all(userId, like, like).map(s => {
    const extra = parseExtra(s.extra);
    return {
      code: s.code, name: s.name, market: s.market || '',
      category: s.category, quote_id: extra.quote_id || '',
      symbol_id: s.symbol_id, source: 'local', type_name: '已添加'
    };
  }).filter(s => s.name);
}

function dedupeSymbols(list) {
  const seen = new Set();
  const out = [];
  for (const s of list) {
    const key = (s.market || '') + '|' + String(s.code || '').toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function labelByCat(c) {
  return ({ stock: '股票', fund: '基金', future: '期货', bond: '债券', other: '其他' }[c] || c);
}

async function fetchStockSearch(keyword, userId) {
  if (!keyword || keyword.length < 1) return [];
  const local = searchLocal(userId, keyword);
  let remote = [];
  try { remote = await searchEastMoney(keyword); } catch (e) {
    console.error('[stock-search][eastmoney]', e.message);
  }
  if (!remote.length) {
    try { remote = await searchTencent(keyword); } catch (e) {
      console.error('[stock-search][tencent]', e.message);
    }
  }
  return dedupeSymbols([...local, ...remote]).slice(0, 12);
}

async function trySina(symbol) {
  const text = await httpText('https://hq.sinajs.cn/list=' + symbol, 'https://finance.sina.com.cn/');
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

async function tryTencentQuote(symbol) {
  const text = await httpText('https://qt.gtimg.cn/q=' + symbol, 'https://gu.qq.com/');
  const match = text.match(/="([^"]+)"/);
  if (!match || !match[1]) return null;
  const parts = match[1].split('~');
  const price = parseFloat(parts[3]);
  const name = parts[1] || '';
  return isNaN(price) || price <= 0 ? null : { price, name, raw: symbol };
}

function quoteCandidates(code, market) {
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
  return tries;
}

async function fetchRealtimePrice(code, market) {
  try {
    for (const symbol of quoteCandidates(code, market)) {
      try {
        const quote = await trySina(symbol);
        if (quote) return quote;
      } catch { /* next */ }
      try {
        const quote = await tryTencentQuote(symbol);
        if (quote) return quote;
      } catch { /* next */ }
    }
    return null;
  } catch (e) {
    console.error('[realtime-price]', e.message);
    return null;
  }
}

function persistQuoteMeta(symbolId, b) {
  const quoteId = (b.quote_id || '').trim();
  const market = (b.market || '').trim();
  const code = (b.symbol_code || '').trim();
  if (!quoteId && !market && !code) return;
  const row = db.prepare('SELECT extra, market, code FROM symbols WHERE id = ?').get(symbolId);
  const extra = parseExtra(row && row.extra);
  if (quoteId) extra.quote_id = quoteId;
  db.prepare('UPDATE symbols SET extra = ?, market = COALESCE(NULLIF(?, ""), market), code = COALESCE(NULLIF(?, ""), code) WHERE id = ?')
    .run(JSON.stringify(extra), market, code, symbolId);
}

function resolveSymbolId(userId, b) {
  const { symbol_id, symbol_name, symbol_code, category, market, direction, multiplier } = b;
  let sid = symbol_id ? parseInt(symbol_id, 10) : null;
  const code = (symbol_code || '').trim();
  const name = (symbol_name || '').trim();
  const cat = category || 'stock';

  if (sid) {
    const sym = db.prepare('SELECT id FROM symbols WHERE id = ? AND user_id = ?').get(sid, userId);
    if (!sym) return { error: '标的不存在' };
    persistQuoteMeta(sid, b);
    return { sid };
  }

  if (code) {
    const byCode = db.prepare('SELECT id FROM symbols WHERE user_id = ? AND code = ? AND category = ?').get(userId, code, cat);
    if (byCode) {
      if (name) db.prepare('UPDATE symbols SET name = ? WHERE id = ?').run(name, byCode.id);
      persistQuoteMeta(byCode.id, b);
      return { sid: byCode.id };
    }
  }
  if (name) {
    if (!CATS.includes(cat)) return { error: '分类必填且需为 stock/fund/future/bond/other' };
    const extra = b.quote_id ? JSON.stringify({ quote_id: b.quote_id }) : null;
    const existing = db.prepare('SELECT id FROM symbols WHERE user_id = ? AND name = ? AND category = ?')
      .get(userId, name, cat);
    if (existing) {
      persistQuoteMeta(existing.id, b);
      return { sid: existing.id };
    }
    const info = db.prepare(`INSERT INTO symbols (user_id, category, code, name, market, direction, multiplier, extra, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(userId, cat, code, name, market || '', direction || 'long', multiplier ? parseFloat(multiplier) : 1, extra, Date.now());
    return { sid: info.lastInsertRowid };
  }
  return { error: '标的不存在，请输入标的名称' };
}

router.get('/symbols/search', async (req, res) => {
  try {
    const { q, cat } = req.query;
    if (!q || q.trim().length < 1) return res.json({ code: 0, data: [] });
    const results = await fetchStockSearch(q.trim(), uid(req));
    const filtered = cat ? results.filter(r => r.category === cat) : results;
    res.json({ code: 0, data: filtered.slice(0, 12) });
  } catch (e) {
    console.error('[symbols/search]', e.message);
    res.json({ code: 0, data: [], message: '搜索服务暂时不可用' });
  }
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
