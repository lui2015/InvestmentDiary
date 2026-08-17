// src/routes/auth.js
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const router = express.Router();

// authRoutes 挂载在公开区，需自行从 cookie 解析用户
const attachUser = (req, res, next) => {
  req.user = auth.getUserFromToken(req.cookies[auth.COOKIE_NAME]);
  next();
};

// 注册
router.post('/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ code: 1, message: '用户名和密码必填' });
  if (username.length < 3 || username.length > 20) return res.status(400).json({ code: 1, message: '用户名需 3-20 位' });
  if (!/^[a-zA-Z0-9_]+$/.test(username)) return res.status(400).json({ code: 1, message: '用户名仅限字母数字下划线' });
  if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password))
    return res.status(400).json({ code: 1, message: '密码至少 8 位且含字母和数字' });

  const exist = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exist) return res.status(409).json({ code: 1, message: '用户名已存在' });

  const hash = auth.hashPassword(password);
  const info = db.prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
    .run(username, hash, Date.now());
  db.prepare('INSERT INTO user_prefs (user_id, theme, updated_at) VALUES (?, ?, ?)')
    .run(info.lastInsertRowid, 'light', Date.now());

  const token = auth.createSession(info.lastInsertRowid);
  res.cookie(auth.COOKIE_NAME, token, {
    httpOnly: true, sameSite: 'lax', maxAge: auth.TTL, path: '/'
  });
  res.json({ code: 0, data: { id: info.lastInsertRowid, username } });
});

// 登录（含失败锁定）
const loginFails = {}; // 简单内存级防暴破：username -> {count, lockUntil}
router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ code: 1, message: '用户名和密码必填' });
  const f = loginFails[username];
  if (f && f.lockUntil > Date.now()) {
    return res.status(429).json({ code: 1, message: '尝试过于频繁，请 15 分钟后再试' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !auth.verifyPassword(password, user.password_hash) || user.status !== 'active') {
    const nf = loginFails[username] || { count: 0, lockUntil: 0 };
    nf.count += 1;
    if (nf.count >= 5) { nf.lockUntil = Date.now() + 15 * 60 * 1000; nf.count = 0; }
    loginFails[username] = nf;
    return res.status(401).json({ code: 1, message: '用户名或密码错误' });
  }
  loginFails[username] = { count: 0, lockUntil: 0 };
  const token = auth.createSession(user.id);
  res.cookie(auth.COOKIE_NAME, token, {
    httpOnly: true, sameSite: 'lax', maxAge: auth.TTL, path: '/'
  });
  res.json({ code: 0, data: { id: user.id, username: user.username } });
});

// 登出
router.post('/logout', (req, res) => {
  const token = req.cookies[auth.COOKIE_NAME];
  auth.destroySession(token);
  res.clearCookie(auth.COOKIE_NAME, { path: '/' });
  res.json({ code: 0 });
});

// 当前用户
router.get('/me', attachUser, (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ code: 1, message: '未登录' });
  res.json({ code: 0, data: { id: user.id, username: user.username, created_at: user.created_at } });
});

// 修改密码
router.put('/password', attachUser, (req, res) => {
  const user = req.user;
  if (!user) return res.status(401).json({ code: 1, message: '未登录' });
  const { old_password, new_password } = req.body || {};
  if (!old_password || !new_password) return res.status(400).json({ code: 1, message: '原密码和新密码必填' });
  if (new_password.length < 8 || !/[a-zA-Z]/.test(new_password) || !/[0-9]/.test(new_password))
    return res.status(400).json({ code: 1, message: '新密码至少 8 位且含字母和数字' });
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(user.id);
  if (!auth.verifyPassword(old_password, row.password_hash))
    return res.status(400).json({ code: 1, message: '原密码错误' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(auth.hashPassword(new_password), user.id);
  res.json({ code: 0 });
});

module.exports = router;
