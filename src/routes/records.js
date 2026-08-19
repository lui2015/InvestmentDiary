// src/routes/records.js - 账户 / 标的 / 交易记录 / 市价 / 行情
const express = require('express');
const db = require('../db');
const router = express.Router();

const uid = (req) => req.user.id;

// ---------- 股票搜索与实时行情 ----------
// 使用东方财富搜索接口（免费，支持拼音/代码/名称模糊匹配）
// 使用新浪行情接口获取实时股价（A股 sh/sz 前缀，港股 hk 前缀）
async function fetchStockSearch(keyword) {
  if (!keyword || keyword.length < 1) return [];
  try {
    const url = 'https://searchapi.eastmoney.com/api/suggest/get?input=' +
      encodeURIComponent(keyword) + '&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=15';
    const res = await fetch(url, { headers: { Referer: 'https://quote.eastmoney.com/' }, signal: AbortSignal.timeout(5000) });
    const json = await res.json();
    if (!json.data || !json.data.QuotationCodeTable) return [];
    return (json.data.QuotationCodeTable.Data || []).map(item => {
      // item 格式: "0.600519|贵州茅台|600519" 或 "116.HK00700|腾讯控股-HK|00700"
      const parts = item.split('|');
      const code = parts[2] || parts[0] || '';
      const name = parts[1] || '';
      let market = '', category = 'stock';
      if (/^6\d{4}$|^9\d{4}$/.test(code)) market = 'SH';       // 上交所
      else if (/^[03]\d{4}$/.test(code)) market = 'SZ';           // 深交所
      else if (/^4\d{4}$|^8\d{4}$/.test(code)) { market = 'BJ'; category = 'other'; } // 北交所
      else if (/^\d{5}$/.test(code)) { market = 'HK'; category = 'stock'; } // 港股数字代码
      else if (/^HK\d{5}$/i.test(code)) { market = 'HK'; category = 'stock'; } // 港股显式
      else if (/^[A-Z]{1,3}\d{1,4}$/.test(code)) { market = 'US'; category = 'stock'; } // 美股
      return { code, name, market, category };
    }).filter(s => s.name && s.code);
  } catch (e) {
    console.error('[stock-search]', e.message);
    return [];
  }
}

// 实时行情：新浪接口（返回格式：var hq_str_sh600519="贵州茅台,...,当前价,..."）
async function fetchRealtimePrice(code, market) {
  try {
    let symbol;
    if (market === 'SH' || /^6\d{4}$|^9\d{4}$/.test(code)) symbol = 'sh' + code.replace(/^0/, '');
    else if (market === 'SZ' || /^[03]\d{4}$/.test(code)) symbol = 'sz' + code;
    else if (market === 'HK' || /^\d{5}$/.test(code)) symbol = 'hk' + (code.length === 5 ? '0' + code : code.replace(/^HK/i, ''));
    else if (market === 'US') symbol = 'gb_' + code.toLowerCase();
    else return null;

    const url = 'https://hq.sinajs.cn/list=' + symbol;
    const res = await fetch(url, {
      headers: { Referer: 'https://finance.sina.com.cn/' },
      signal: AbortSignal.timeout(5000)
    });
    const text = await res.text();
    // 解析: var hq_str_sh600519="贵州茅台,....,当前价(字段3),..."
    const match = text.match(/="([^"]+)"/);
    if (!match || !match[1]) return null;
    const fields = match[1].split(',');
    // A股: 字段3=当前价; 港股: 字段6=当前价; 美股: 字段1=当前价
    const price = parseFloat(
      symbol.startsWith('hk') ? fields[6] :
        symbol.startsWith('gb_') ? fields[1] : fields[3]
    );
    return isNaN(price) ? null : price;
  } catch (e) {
    console.error('[realtime-price]', e.message);
    return null;
  }
}

// GET /symbols/search?q=茅台&cat=stock — 搜索股票（公开接口，无需登录）
router.get('/symbols/search', async (req, res) => {
  const { q, cat } = req.query;
  if (!q || q.trim().length < 1) return res.json({ code: 0, data: [] });
  const results = await fetchStockSearch(q.trim());
  // 按分类过滤（如果指定）
  const filtered = cat ? results.filter(r => r.category === cat) : results;
  res.json({ code: 0, data: filtered.slice(0, 15) });
});

// GET /prices/realtime?code=600519&market=SH — 实时行情（需登录）
router.get('/prices/realtime', async (req, res) => {
  const { code, market } = req.query;
  if (!code) return res.status(400).json({ code: 1, message: '缺少股票代码' });
  const price = await fetchRealtimePrice(code, market || '');
  if (price == null) return res.json({ code: 0, data: { price: null, error: '未获取到行情数据' } });
  res.json({ code: 0, data: { price } });
});

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
