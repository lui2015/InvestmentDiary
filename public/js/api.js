// api.js - 简易封装 fetch，统一返回 { code, message, data }
const API = {
  async req(method, url, body) {
    const opts = { method, headers: {}, credentials: 'same-origin' };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (res.headers.get('content-type') && res.headers.get('content-type').includes('text/csv')) {
      return { code: 0, data: await res.blob() };
    }
    let json = {};
    try { json = await res.json(); } catch (e) { json = { code: 1, message: '响应解析失败' }; }
    return json;
  },
  get: (u) => API.req('GET', u),
  post: (u, b) => API.req('POST', u, b),
  put: (u, b) => API.req('PUT', u, b),
  del: (u) => API.req('DELETE', u),
};

function qs(obj) {
  const p = new URLSearchParams();
  Object.keys(obj || {}).forEach(k => {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') p.set(k, obj[k]);
  });
  const s = p.toString();
  return s ? '?' + s : '';
}

const Api = {
  register: (u, p, remember) => API.post('api/auth/register', { username: u, password: p, remember }),
  login: (u, p, remember) => API.post('api/auth/login', { username: u, password: p, remember }),
  logout: () => API.post('api/auth/logout', {}),
  me: () => API.get('api/auth/me'),
  changePwd: (o, n) => API.put('api/auth/password', { old_password: o, new_password: n }),

  listAccounts: () => API.get('api/accounts'),
  addAccount: (b) => API.post('api/accounts', b),
  updateAccount: (id, b) => API.put('api/accounts/' + id, b),
  delAccount: (id) => API.del('api/accounts/' + id),
  listSymbols: () => API.get('api/symbols'),
  addSymbol: (b) => API.post('api/symbols', b),
  delSymbol: (id) => API.del('api/symbols/' + id),
  listTrades: (q) => API.get('api/trades' + (typeof q === 'string' ? (q ? '?' + q : '') : qs(q))),
  getTrade: (id) => API.get('api/trades/' + id),
  addTrade: (b) => API.post('api/trades', b),
  updateTrade: (id, b) => API.put('api/trades/' + id, b),
  delTrade: (id) => API.del('api/trades/' + id),
  setPrice: (id, price) => API.put('api/prices/' + id, { price }),
  refreshPrices: () => API.post('api/prices/refresh', {}),

  overview: () => API.get('api/stats/overview'),
  ranking: () => API.get('api/stats/ranking'),
  trend: () => API.get('api/stats/trend'),
  discipline: () => API.get('api/stats/discipline'),

  listRules: () => API.get('api/alerts/rules'),
  addRule: (b) => API.post('api/alerts/rules', b),
  toggleRule: (id, status) => API.put('api/alerts/rules/' + id, { status }),
  delRule: (id) => API.del('api/alerts/rules/' + id),
  listLogs: () => API.get('api/alerts/logs'),
  unread: () => API.get('api/alerts/unread'),
  handleLog: (id) => API.post('api/alerts/logs/' + id + '/handle', {}),
  handleAllLogs: () => API.post('api/alerts/logs/handle-all', {}),
  checkAlerts: () => API.post('api/alerts/check', {}),

  listReviews: () => API.get('api/reviews/'),
  addReview: (b) => API.post('api/reviews/', b),
  updateReview: (id, b) => API.put('api/reviews/' + id, b),
  delReview: (id) => API.del('api/reviews/' + id),
  reviewTemplate: () => API.get('api/reviews/template'),
  periodInsight: (start, end) => API.get('api/reviews/period-insight' + qs({ start, end })),

  getPref: () => API.get('api/pref/'),
  setTheme: (t) => API.put('api/pref/theme', { theme: t }),
  exportData: () => API.get('api/pref/export'),
  importData: (data) => API.post('api/pref/import', data),

  searchStock: (q, cat) => API.get('api/symbols/search' + qs({ q, cat })),
  realtimePrice: (code, market) => API.get('api/prices/realtime' + qs({ code, market })),
};
