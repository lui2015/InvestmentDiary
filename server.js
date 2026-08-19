// server.js - 投资日记 后端入口
require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./src/db');
const auth = require('./src/auth');
const authRoutes = require('./src/routes/auth');
const recordsRoutes = require('./src/routes/records');
const statsRoutes = require('./src/routes/stats');
const alertsRoutes = require('./src/routes/alerts');
const reviewsRoutes = require('./src/routes/reviews');
const prefRoutes = require('./src/routes/pref');

const app = express();
const BASE = process.env.BASE_PATH || ''; // 如 /investmentDiary

// 解析 cookie
app.use((req, res, next) => {
  const c = req.headers.cookie || '';
  req.cookies = {};
  c.split(';').forEach(pair => {
    const i = pair.indexOf('=');
    if (i > -1) req.cookies[pair.slice(0, i).trim()] = decodeURIComponent(pair.slice(i + 1).trim());
  });
  next();
});

app.use(express.json());

// 鉴权中间件：注入 req.user
const requireAuth = (req, res, next) => {
  const user = auth.getUserFromToken(req.cookies[auth.COOKIE_NAME]);
  if (!user) return res.status(401).json({ code: 1, message: '未登录或会话已过期' });
  req.user = user;
  next();
};

// 静态资源（前端），实时读盘
const publicDir = path.join(__dirname, 'public');
app.use(BASE + '/', express.static(publicDir, { extensions: ['html'] }));

// API
const api = express.Router();
api.get('/health', (req, res) => res.json({ code: 0, status: 'ok' }));
// 股票搜索接口（公开，无需登录，用于输入联想）
api.get('/symbols/search', recordsRoutes);
api.use('/auth', authRoutes);          // 公开
api.use(requireAuth);                  // 以下均需登录
api.use(recordsRoutes);                // /api/accounts|symbols|trades|prices
api.use('/stats', statsRoutes);        // /api/stats/...
api.use('/alerts', alertsRoutes);      // /api/alerts/...
api.use('/reviews', reviewsRoutes);    // /api/reviews/...
api.use('/pref', prefRoutes);          // /api/pref/...

app.use(BASE + '/api', api);

// 兜底 404
app.use((req, res) => {
  if (req.path.startsWith(BASE + '/api')) return res.status(404).json({ code: 1, message: '接口不存在' });
  res.status(404).send('Not Found');
});

const PORT = parseInt(process.env.PORT, 10) || 3260;
app.listen(PORT, () => {
  console.log(`投资日记服务已启动: http://localhost:${PORT}${BASE}/`);
});
