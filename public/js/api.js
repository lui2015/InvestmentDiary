// api.js - 简易封装 fetch，统一返回 { code, message, data }
const API = {
  async req(method, url, body) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    let json = {};
    try { json = await res.json(); } catch (e) { json = { code: 1, message: '响应解析失败' }; }
    return json;
  },
  get: (u) => API.req('GET', u),
  post: (u, b) => API.req('POST', u, b),
  put: (u, b) => API.req('PUT', u, b),
  del: (u) => API.req('DELETE', u),
};

// 业务接口
const Api = {
  // 鉴权
  register: (u, p) => API.post('/api/auth/register', { username: u, password: p }),
  login: (u, p) => API.post('/api/auth/login', { username: u, password: p }),
  logout: () => API.post('/api/auth/logout', {}),
  me: () => API.get('/api/auth/me'),
  changePwd: (o, n) => API.put('/api/auth/password', { old_password: o, new_password: n }),
  // 账户/标的/交易
  listAccounts: () => API.get('/api/accounts'),
  addAccount: (b) => API.post('/api/accounts', b),
  delAccount: (id) => API.del('/api/accounts/' + id),
  listSymbols: () => API.get('/api/symbols'),
  addSymbol: (b) => API.post('/api/symbols', b),
  delSymbol: (id) => API.del('/api/symbols/' + id),
  listTrades: (q) => API.get('/api/trades' + (q ? '?' + q : '')),
  addTrade: (b) => API.post('/api/trades', b),
  delTrade: (id) => API.del('/api/trades/' + id),
  setPrice: (id, price) => API.put('/api/prices/' + id, { price }),
  // 统计
  overview: () => API.get('/api/stats/overview'),
  ranking: () => API.get('/api/stats/ranking'),
  trend: () => API.get('/api/stats/trend'),
  // 提醒
  listRules: () => API.get('/api/alerts/rules'),
  addRule: (b) => API.post('/api/alerts/rules', b),
  delRule: (id) => API.del('/api/alerts/rules/' + id),
  listLogs: () => API.get('/api/alerts/logs'),
  handleLog: (id) => API.post('/api/alerts/logs/' + id + '/handle', {}),
  checkAlerts: () => API.post('/api/alerts/check', {}),
  // 复盘
  listReviews: () => API.get('/api/reviews/'),
  addReview: (b) => API.post('/api/reviews/', b),
  updateReview: (id, b) => API.put('/api/reviews/' + id, b),
  delReview: (id) => API.del('/api/reviews/' + id),
  reviewTemplate: () => API.get('/api/reviews/template'),
  // 偏好
  getPref: () => API.get('/api/pref/'),
  setTheme: (t) => API.put('/api/pref/theme', { theme: t }),
  exportData: () => API.get('/api/pref/export'),
};
