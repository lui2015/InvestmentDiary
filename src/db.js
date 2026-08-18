// src/db.js - SQLite 数据库初始化与表结构
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
require('dotenv').config();

const DATA_DIR = process.env.DATA_DIR || './data';
const dbPath = path.isAbsolute(DATA_DIR)
  ? path.join(DATA_DIR, 'investment.db')
  : path.join(__dirname, '..', DATA_DIR, 'investment.db');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_prefs (
  user_id INTEGER PRIMARY KEY,
  theme TEXT NOT NULL DEFAULT 'light',
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  broker TEXT,
  type TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS symbols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  category TEXT NOT NULL,
  code TEXT,
  name TEXT NOT NULL,
  market TEXT,
  direction TEXT,
  leverage REAL,
  multiplier REAL DEFAULT 1,
  extra TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  account_id INTEGER,
  symbol_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  side TEXT NOT NULL,
  quantity REAL NOT NULL,
  price REAL NOT NULL,
  amount REAL NOT NULL,
  fee REAL DEFAULT 0,
  datetime INTEGER NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL,
  FOREIGN KEY (symbol_id) REFERENCES symbols(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS market_prices (
  user_id INTEGER NOT NULL,
  symbol_id INTEGER NOT NULL,
  price REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, symbol_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (symbol_id) REFERENCES symbols(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  symbol_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  mode TEXT NOT NULL,
  threshold REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_triggered INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (symbol_id) REFERENCES symbols(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS alert_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  rule_id INTEGER NOT NULL,
  symbol_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  triggered_at INTEGER NOT NULL,
  handled INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (rule_id) REFERENCES alert_rules(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  period_type TEXT NOT NULL,
  start_date INTEGER NOT NULL,
  end_date INTEGER NOT NULL,
  content TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

// ---------- 初始化默认账号 ----------
// 首次启动（users 表为空）时创建默认账号，便于直接体验
(function seedDefaultUser() {
  try {
    const bcrypt = require('bcryptjs');
    const username = 'luli';
    const password = 'luli116574';
    const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
    if (exists) return;
    const hash = bcrypt.hashSync(password, 10);
    const now = Date.now();
    const info = db.prepare(
      'INSERT INTO users (username, password_hash, status, created_at) VALUES (?, ?, ?, ?)'
    ).run(username, hash, 'active', now);
    db.prepare(
      'INSERT INTO user_prefs (user_id, theme, updated_at) VALUES (?, ?, ?)'
    ).run(info.lastInsertRowid, 'dark', now);
    console.log('[seed] 已创建默认账号：' + username + ' / ' + password);
  } catch (e) {
    console.error('[seed] 初始化默认账号失败：', e.message);
  }
})();

// ---------- 预设投资标的 ----------
// 为新用户自动创建常用投资标的模板，方便直接体验交易功能
const DEFAULT_SYMBOLS = [
  // A股股票
  { category: 'stock', code: '600519', name: '贵州茅台', market: 'SH' },
  { category: 'stock', code: '300750', name: '宁德时代', market: 'SZ' },
  { category: 'stock', code: '002594', name: '比亚迪', market: 'SZ' },
  { category: 'stock', code: '601318', name: '中国平安', market: 'SH' },
  // 港股
  { category: 'stock', code: '00700', name: '腾讯控股', market: 'HK' },
  { category: 'stock', code: '09988', name: '阿里巴巴', market: 'HK' },
  // 美股
  { category: 'stock', code: 'AAPL', name: '苹果 Apple', market: 'US' },
  { category: 'stock', code: 'TSLA', name: '特斯拉 Tesla', market: 'US' },
  { category: 'stock', code: 'NVDA', name: '英伟达 NVIDIA', market: 'US' },
  // 基金
  { category: 'fund', code: '510300', name: '沪深300ETF', market: 'SH' },
  { category: 'fund', code: '159915', name: '创业板ETF', market: 'SZ' },
  { category: 'fund', code: '110011', name: '易方达中小盘', market: 'SH' },
  // 债券
  { category: 'bond', code: '019001', name: '国债(5年期)', market: 'SH' },
  { category: 'bond', code: '019002', name: '国债(10年期)', market: 'SH' },
];

function seedDefaultSymbols(userId) {
  try {
    const existing = db.prepare('SELECT COUNT(*) AS cnt FROM symbols WHERE user_id = ?').get(userId);
    if (existing && existing.cnt > 0) return 0; // 已有标的则跳过
    const now = Date.now();
    let count = 0;
    for (const s of DEFAULT_SYMBOLS) {
      db.prepare(`INSERT INTO symbols (user_id, category, code, name, market, direction, multiplier, created_at)
        VALUES (?, ?, ?, ?, ?, 'long', 1, ?)`).run(userId, s.category, s.code || '', s.name, s.market || '', now);
      count++;
    }
    console.log('[seed] 为用户 ' + userId + ' 创建了 ' + count + ' 个预设标的');
    return count;
  } catch (e) {
    console.error('[seed] 初始化预设标的失败：', e.message);
    return 0;
  }
}

module.exports = db;
module.exports.seedDefaultSymbols = seedDefaultSymbols;
