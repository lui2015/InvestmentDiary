// src/auth.js - 会话与鉴权工具
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');

const COOKIE_NAME = process.env.COOKIE_NAME || 'id_session';
const TTL = (parseInt(process.env.SESSION_TTL_HOURS, 10) || 168) * 3600 * 1000;

function genToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 创建会话并返回 token
function createSession(userId, remember) {
  const token = genToken();
  const now = Date.now();
  const ttl = remember ? 90 * 24 * 3600 * 1000 : TTL;
  db.prepare(
    'INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).run(token, userId, now + ttl, now);
  return token;
}

function destroySession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

// 校验 cookie，返回 user 或 null
function getUserFromToken(token) {
  if (!token) return null;
  const sess = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!sess) return null;
  if (sess.expires_at < Date.now()) {
    destroySession(token);
    return null;
  }
  const user = db.prepare('SELECT id, username, status, created_at FROM users WHERE id = ?').get(sess.user_id);
  if (!user || user.status !== 'active') return null;
  return user;
}

function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}

function verifyPassword(pw, hash) {
  return bcrypt.compareSync(pw, hash);
}

module.exports = {
  COOKIE_NAME, TTL, createSession, destroySession, getUserFromToken,
  hashPassword, verifyPassword
};
