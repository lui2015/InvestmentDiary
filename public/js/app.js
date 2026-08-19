// app.js - 单页应用：路由、页面渲染、交互
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const fmt = (n, d = 2) => (n == null || n === '' || Number.isNaN(Number(n)) ? '-' : Number(n).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const fmtMoney = (n) => (n == null ? '-' : '¥' + fmt(n));
  const fmtSigned = (n) => {
    if (n == null || Number.isNaN(Number(n))) return '-';
    const v = Number(n);
    return (v > 0 ? '+' : '') + fmtMoney(v);
  };
  const pnlClass = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const toDatetimeLocal = (ts) => {
    const d = new Date(ts || Date.now());
    return `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const fmtDay = (ts) => new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  const fmtDate = (ts) => new Date(ts).toLocaleDateString('zh-CN');
  const fmtDateTime = (ts) => new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const labelCat = (c) => ({ stock: '股票', fund: '基金', future: '期货', bond: '债券', other: '其他' }[c] || c);
  const actLabel = (a) => ({ open: '开仓', add: '加仓', reduce: '减仓', close: '平仓', dividend: '分红', fee: '费用' }[a] || a);
  const ptype = (t) => ({ week: '周复盘', month: '月复盘', custom: '自定义' }[t] || t);

  const state = { user: null, route: 'dashboard', unread: 0 };
  const ROUTES = [
    { key: 'dashboard', label: '总览', ico: '📊', title: '总览', sub: '一眼看清仓位、盈亏与待办' },
    { key: 'trades', label: '交易', ico: '💱', title: '交易记录', sub: '每一笔买卖都记下来，才算自己的账' },
    { key: 'positions', label: '持仓', ico: '📈', title: '当前持仓', sub: '更新市价后即可看到浮动盈亏' },
    { key: 'alerts', label: '提醒', ico: '🔔', title: '止盈止损', sub: '到了计划里的位置，及时提醒自己' },
    { key: 'reviews', label: '复盘', ico: '📝', title: '投资复盘', sub: '把交易和当时的想法放在一起看' },
    { key: 'profile', label: '我的', ico: '👤', title: '我的', sub: '账户、备份与外观' },
  ];

  function toast(msg, type) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (type === 'err' ? ' err' : type === 'ok' ? ' ok' : '');
    t.hidden = false;
    clearTimeout(t._t);
    t._t = setTimeout(() => (t.hidden = true), 2400);
  }
  async function guard(p) {
    const r = await p;
    if (r.code !== 0 && r.message) toast(r.message, 'err');
    return r;
  }

  function openModal(title, bodyHtml) {
    $('#formTitle').textContent = title;
    $('#formBody').innerHTML = bodyHtml || '<p class="muted">内容加载中…</p>';
    $('#formModal').hidden = false;
    return $('#formBody');
  }
  function closeModal() { $('#formModal').hidden = true; }

  function confirmDialog(msg) {
    return new Promise(res => {
      openModal('请确认', `<p style="margin:0 0 16px">${esc(msg)}</p>
        <div class="row" style="justify-content:flex-end;gap:8px">
          <button class="btn ghost" id="cfNo">取消</button>
          <button class="btn danger" id="cfYes">确定</button></div>`);
      $('#cfYes').onclick = () => { closeModal(); res(true); };
      $('#cfNo').onclick = () => { closeModal(); res(false); };
    });
  }

  function lineChart(values, labels) {
    if (!values || !values.length) return '<div class="muted">记几笔买卖后，这里会出现盈亏曲线</div>';
    const w = 560, h = 180, padL = 8, padR = 8, padT = 12, padB = 22;
    const max = Math.max(...values, 0), min = Math.min(...values, 0);
    const range = (max - min) || 1;
    const x = i => padL + (i * (w - padL - padR)) / (values.length - 1 || 1);
    const y = v => h - padB - ((v - min) / range) * (h - padT - padB);
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${padL},${h - padB} ${pts} ${w - padR},${h - padB}`;
    const zero = y(0);
    const dots = values.map((v, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.6" fill="var(--primary)"/>`).join('');
    const first = labels && labels[0] ? labels[0] : '';
    const last = labels && labels.length ? labels[labels.length - 1] : '';
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="盈亏走势">
      <defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--primary)" stop-opacity=".28"/>
        <stop offset="100%" stop-color="var(--primary)" stop-opacity="0"/>
      </linearGradient></defs>
      <polygon points="${area}" fill="url(#areaFill)"/>
      <line x1="${padL}" y1="${zero}" x2="${w - padR}" y2="${zero}" stroke="var(--border)"/>
      <polyline points="${pts}" fill="none" stroke="var(--primary)" stroke-width="2.2" stroke-linejoin="round"/>
      ${dots}
    </svg>
    <div class="chart-labels"><span>${esc(first)}</span><span>${esc(last)}</span></div>`;
  }

  function pieChart(data) {
    if (!data.length) return '<div class="muted">有持仓后将显示品类占比</div>';
    const total = data.reduce((s, d) => s + Math.abs(d.market || 0), 0) || 1;
    const colors = ['#22d3ee', '#818cf8', '#fbbf24', '#34d399', '#fb7185'];
    let ang = -Math.PI / 2; const r = 58, cx = 70, cy = 70;
    const segs = data.map((d, i) => {
      const frac = Math.abs(d.market || 0) / total;
      const a2 = ang + frac * 2 * Math.PI;
      const x1 = cx + r * Math.cos(ang), y1 = cy + r * Math.sin(ang);
      const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
      const large = frac > 0.5 ? 1 : 0;
      ang = a2;
      return `<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${colors[i % colors.length]}"/>`;
    }).join('');
    const legend = data.map((d, i) => `<div class="row" style="gap:8px;align-items:center">
      <span class="swatch" style="background:${colors[i % colors.length]}"></span>
      <span>${labelCat(d.category)}</span>
      <b style="margin-left:auto">${fmtMoney(d.market)}</b></div>`).join('');
    return `<div class="row" style="gap:18px;align-items:center">
      <svg width="140" height="140" viewBox="0 0 140 140">${segs}<circle cx="70" cy="70" r="32" fill="var(--bg)"/></svg>
      <div class="legend" style="flex:1">${legend}</div></div>`;
  }

  function setShell(on) {
    $('#sidebar').style.display = on ? '' : 'none';
    $('#bottomNav').style.display = on ? '' : 'none';
    $('#logoutBtn').hidden = !on;
    $('#quickAdd').hidden = !on;
    $('#fabAdd').hidden = !on;
    $('#userChip').hidden = !on;
    document.querySelector('.topbar').style.display = on ? '' : 'none';
    document.body.classList.toggle('login-mode', !on);
    if (on && state.user) {
      $('#userName').textContent = state.user.username;
      $('#userAvatar').textContent = (state.user.username || 'U').slice(0, 1).toUpperCase();
    }
  }

  async function refreshUnread() {
    if (!state.user) { state.unread = 0; return; }
    try {
      const r = await Api.unread();
      state.unread = (r.data && r.data.count) || 0;
      renderNav();
    } catch { /* ignore */ }
  }

  function renderNav() {
    const badge = state.unread > 0 ? `<span class="nav-badge">${state.unread > 99 ? '99+' : state.unread}</span>` : '';
    const item = (r, compact) => {
      const b = r.key === 'alerts' ? badge : '';
      if (compact) return `<a class="nav-item ${r.key === state.route ? 'active' : ''}" href="#/${r.key}"><span class="nav-ico">${r.ico}</span><span>${r.label}</span>${b}</a>`;
      return `<a class="nav-item ${r.key === state.route ? 'active' : ''}" href="#/${r.key}"><span class="nav-ico">${r.ico}</span><span class="nav-txt">${r.label}</span>${b}</a>`;
    };
    $('#sideNav').innerHTML = ROUTES.map(r => item(r, false)).join('');
    $('#bottomNav').innerHTML = ROUTES.map(r => item(r, true)).join('');
    const cur = ROUTES.find(r => r.key === state.route);
    if (cur) {
      $('#pageTitle').textContent = cur.title;
      $('#pageSub').textContent = cur.sub;
    }
  }

  const PAGES = {
    dashboard: renderDashboard, trades: renderTrades, positions: renderPositions,
    alerts: renderAlerts, reviews: renderReviews, profile: renderProfile, login: renderLogin
  };

  async function route() {
    try {
      const hash = location.hash.replace('#/', '') || 'dashboard';
      state.route = (ROUTES.some(r => r.key === hash) || hash === 'login') ? hash : 'dashboard';
      if (state.user && state.route === 'login') { location.hash = '#/dashboard'; return; }
      if (!state.user && state.route !== 'login') {
        const me = await Api.me();
        if (me.code === 0) state.user = me.data;
        else { location.hash = '#/login'; return; }
      }
      setShell(!!state.user && state.route !== 'login');
      renderNav();
      if (state.user) refreshUnread();
      const fn = PAGES[state.route] || renderDashboard;
      $('#content').innerHTML = '<div class="empty"><div class="big">⏳</div>加载中…</div>';
      await fn($('#content'));
    } catch (e) {
      console.error('[route]', e);
      $('#content').innerHTML = `<div class="empty"><div class="big">⚠️</div><p>页面加载出错</p><button class="btn primary mt" onclick="location.reload()">刷新页面</button></div>`;
    }
  }

  function renderLogin(root) {
    setShell(false);
    root.innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <div class="login-logo">📈</div>
          <div class="login-title">投资日记</div>
          <div class="login-sub">把每一笔交易和每一次决策，记在自己的账本里</div>
          <div class="login-feats">
            <span class="badge blue">盈亏统计</span>
            <span class="badge green">止盈止损</span>
            <span class="badge orange">结构化复盘</span>
          </div>
          <div class="field"><label>用户名</label><input id="lu" autocomplete="username" placeholder="3-20 位字母数字下划线"/></div>
          <div class="field"><label>密码</label><input id="lp" type="password" autocomplete="current-password" placeholder="至少 8 位，含字母和数字"/></div>
          <label class="check-row"><input id="lm" type="checkbox" checked/> 记住登录（90 天）</label>
          <button class="btn primary block" id="doLogin">登录</button>
          <p class="muted mt" style="text-align:center">还没有账号？<a href="#" id="toReg">注册一个</a></p>
        </div>
      </div>`;
    const doLogin = async () => {
      const r = await guard(Api.login($('#lu').value.trim(), $('#lp').value, $('#lm').checked));
      if (r.code === 0) { state.user = r.data; await afterAuth(); }
    };
    $('#doLogin').onclick = doLogin;
    $('#lp').onkeydown = e => { if (e.key === 'Enter') doLogin(); };
    $('#toReg').onclick = (e) => { e.preventDefault(); openReg(); };
  }

  function openReg() {
    openModal('注册新账号', `
      <div class="field"><label>用户名</label><input id="ru" autocomplete="username" placeholder="3-20 位字母数字下划线"/></div>
      <div class="field"><label>密码</label><input id="rp" type="password" autocomplete="new-password" placeholder="至少 8 位，含字母和数字"/></div>
      <label class="check-row"><input id="rm" type="checkbox" checked/> 注册后保持登录</label>
      <button class="btn primary block" id="doReg">注册并进入</button>`);
    $('#doReg').onclick = async () => {
      const r = await guard(Api.register($('#ru').value.trim(), $('#rp').value, $('#rm').checked));
      if (r.code === 0) { closeModal(); state.user = r.data; await afterAuth(); }
    };
  }

  async function afterAuth() {
    const pref = await Api.getPref().catch(() => null);
    if (pref && pref.data) Theme.set(pref.data.theme); else Theme.apply(Theme.localTheme || 'dark');
    setShell(true);
    if ((location.hash || '') === '#/dashboard') await route();
    else location.hash = '#/dashboard';
  }

  function emptyState(icon, title, desc, btnLabel, onClickId) {
    return `<div class="empty">
      <div class="big">${icon}</div>
      <h3>${title}</h3>
      <p>${desc}</p>
      ${btnLabel ? `<button class="btn primary" id="${onClickId}">${btnLabel}</button>` : ''}
    </div>`;
  }

  async function renderDashboard(root) {
    try {
      const [ov, rank, trend, recent, logs] = await Promise.all([
        Api.overview(), Api.ranking(), Api.trend(), Api.listTrades({ limit: 6 }), Api.listLogs()
      ]);
      if (ov.code !== 0) {
        root.innerHTML = emptyState('⚠️', '数据加载失败', esc(ov.message || '请稍后重试'), '刷新', 'reloadBtn');
        $('#reloadBtn').onclick = () => location.reload();
        return;
      }
      Api.checkAlerts().then(refreshUnread).catch(() => {});
      const o = ov.data.overview;
      const d = ov.data.discipline || {};
      const pending = (logs.data || []).filter(l => !l.handled).slice(0, 3);
      const hasTrades = (recent.data || []).length > 0;
      const miss = o.missing_price_count || 0;

      root.innerHTML = `
        ${pending.length ? `<div class="alert-banner">
          <div><b>有 ${pending.length} 条止盈止损待处理</b>
            <div class="muted">${esc(pending[0].message)}</div></div>
          <a class="btn small" href="#/alerts">去处理</a>
        </div>` : ''}
        <div class="hero">
          <div class="hero-kicker">累计盈亏</div>
          <div class="hero-value ${pnlClass(o.total_pnl)}">${fmtSigned(o.total_pnl)}</div>
          <div class="hero-meta">
            <span>收益率 <b class="${pnlClass(o.total_return)}">${o.total_return || 0}%</b></span>
            <span>持仓 ${o.positions_count} 个</span>
            <span>投入 ${fmtMoney(o.invested)}</span>
            ${miss ? `<span class="neg">还有 ${miss} 个持仓未更新市价</span>` : ''}
          </div>
          <div class="hero-pills">
            <span class="pill">浮动 ${fmtSigned(o.float_pnl)}</span>
            <span class="pill">已实现 ${fmtSigned(o.realized)}</span>
            <span class="pill">市值 ${fmtMoney(o.market_value)}</span>
            <span class="pill">胜率 ${d.win_rate == null ? '-' : d.win_rate + '%'}</span>
          </div>
          <div class="hero-actions">
            <button class="btn primary small" id="dashAdd">+ 记一笔</button>
            <button class="btn small" id="dashRefresh">刷新行情</button>
            <button class="btn ghost small" id="dashReview">写复盘</button>
          </div>
        </div>
        ${!hasTrades ? `
          <div class="card mt">
            ${emptyState('📒', '从第一笔记账开始', '这个工具的价值在于连续记录。先把最近一笔买卖记下来，总览、持仓和复盘就会跟着亮起来。', '+ 记下第一笔交易', 'firstTrade')}
            <div class="onboard">
              <div class="onboard-item"><div class="onboard-num">1</div><div><b>记交易</b><div class="muted">搜股票名或代码，数量和价格填完就能保存</div></div></div>
              <div class="onboard-item"><div class="onboard-num">2</div><div><b>刷新市价</b><div class="muted">持仓页一键拉行情，自动算浮动盈亏</div></div></div>
              <div class="onboard-item"><div class="onboard-num">3</div><div><b>设提醒、写复盘</b><div class="muted">到了止盈止损点会站内提醒，周末把想法沉淀下来</div></div></div>
            </div>
          </div>` : `
          <div class="grid cols-2 mt">
            <div class="card"><div class="spread mb"><h3 class="section-title">累计已实现盈亏</h3></div>${lineChart(trend.data.cumulative || trend.data.values, trend.data.labels)}</div>
            <div class="card"><div class="spread mb"><h3 class="section-title">持仓品类</h3></div>${pieChart(ov.data.categoryData)}</div>
          </div>
          <div class="section-head"><h3 class="section-title">最近交易</h3><a class="muted" href="#/trades">全部记录 →</a></div>
          ${tradeListHtml(recent.data)}
          <div class="grid cols-2 mt">
            <div class="card"><h3 class="section-title mb">盈利榜</h3>${rankList(rank.data.profit)}</div>
            <div class="card"><h3 class="section-title mb">亏损榜</h3>${rankList(rank.data.loss)}</div>
          </div>`}`;

      const add = () => openTradeForm();
      if ($('#dashAdd')) $('#dashAdd').onclick = add;
      if ($('#firstTrade')) $('#firstTrade').onclick = add;
      if ($('#dashReview')) $('#dashReview').onclick = () => { location.hash = '#/reviews'; };
      if ($('#dashRefresh')) $('#dashRefresh').onclick = () => refreshQuotes(renderDashboard);
    } catch (e) {
      console.error('[dashboard]', e);
      root.innerHTML = emptyState('⚠️', '页面加载出错', '请刷新重试', '刷新', 'reloadBtn');
      if ($('#reloadBtn')) $('#reloadBtn').onclick = () => location.reload();
    }
  }

  function rankList(arr) {
    if (!arr || !arr.length) return '<div class="muted">暂无该项数据</div>';
    return `<table class="table"><tr><th>标的</th><th>浮动</th><th>收益率</th></tr>` +
      arr.slice(0, 5).map(r => `<tr><td>${esc(r.name)}${r.code ? ' <span class="muted">' + esc(r.code) + '</span>' : ''}</td>
        <td class="${pnlClass(r.float)}">${fmtSigned(r.float)}</td>
        <td class="${pnlClass(r.pnl_pct)}">${r.pnl_pct == null ? '-' : r.pnl_pct + '%'}</td></tr>`).join('') + '</table>';
  }

  function tradeListHtml(rows, opts = {}) {
    const list = rows || [];
    if (!list.length) return '<div class="muted" style="padding:12px 0">没有符合条件的记录</div>';
    const cards = `<div class="trade-list mobile-only">${list.map(t => `
      <div class="trade-card">
        <div class="t-top">
          <div>
            <div class="t-name">${esc(t.symbol_name)} ${t.symbol_code ? `<span class="muted">${esc(t.symbol_code)}</span>` : ''}</div>
            <div class="t-meta">${fmtDate(t.datetime)} · ${actLabel(t.action)} · ${t.side === 'buy' ? '买' : '卖'} · ${fmt(t.quantity)} × ${fmt(t.price)}</div>
          </div>
          <div class="t-amt">${fmtMoney(t.amount)}</div>
        </div>
        <div class="pos-actions">
          <span class="badge blue">${labelCat(t.category)}</span>
          ${t.account_name ? `<span class="badge">${esc(t.account_name)}</span>` : ''}
          ${opts.actions === false ? '' : `<button class="btn small ghost" data-edit="${t.id}">编辑</button>
          <button class="btn small ghost" data-del="${t.id}">删除</button>`}
        </div>
      </div>`).join('')}</div>`;
    const table = `<div class="card desktop-only"><div class="table-wrap"><table class="table">
      <tr><th>时间</th><th>标的</th><th>账户</th><th>动作</th><th>方向</th><th>数量</th><th>价格</th><th>金额</th><th>备注</th>${opts.actions === false ? '' : '<th></th>'}</tr>
      ${list.map(t => `<tr>
        <td>${fmtDate(t.datetime)}</td>
        <td>${esc(t.symbol_name)}${t.symbol_code ? '<div class="muted" style="font-size:11px">' + esc(t.symbol_code) + '</div>' : ''}</td>
        <td class="muted">${esc(t.account_name || '-')}</td>
        <td><span class="badge blue">${actLabel(t.action)}</span></td>
        <td>${t.side === 'buy' ? '买' : '卖'}</td>
        <td>${fmt(t.quantity)}</td><td>${fmt(t.price)}</td><td>${fmtMoney(t.amount)}</td>
        <td class="muted">${esc(t.note)}</td>
        ${opts.actions === false ? '' : `<td>
          <button class="btn small ghost" data-edit="${t.id}">改</button>
          <button class="btn small ghost" data-del="${t.id}">删</button></td>`}
      </tr>`).join('')}
    </table></div></div>`;
    return cards + table;
  }

  function bindTradeActions(root, reload) {
    $$('[data-del]', root).forEach(b => b.onclick = async () => {
      if (await confirmDialog('确定删除该笔交易？持仓会按剩余流水重算。')) {
        await guard(Api.delTrade(b.dataset.del));
        reload();
      }
    });
    $$('[data-edit]', root).forEach(b => b.onclick = async () => {
      const r = await guard(Api.getTrade(b.dataset.edit));
      if (r.code === 0) openTradeForm(r.data);
    });
  }

  async function refreshQuotes(reloadFn) {
    toast('正在拉取最新行情…');
    const r = await guard(Api.refreshPrices());
    if (r.code === 0) {
      toast(`已更新 ${r.data.count} 个标的` + (r.data.failed && r.data.failed.length ? `，${r.data.failed.length} 个未取到` : ''), 'ok');
      await Api.checkAlerts();
      await refreshUnread();
      await reloadFn($('#content'));
    }
  }

  async function renderTrades(root) {
    try {
      const q = ($('#tf_q') && $('#tf_q').value) || '';
      const category = ($('#tf_cat') && $('#tf_cat').value) || '';
      const from = ($('#tf_from') && $('#tf_from').value) || '';
      const to = ($('#tf_to') && $('#tf_to').value) || '';
      const trades = await Api.listTrades({ q, category, from, to, limit: 200 });
      const rows = trades.data || [];
      root.innerHTML = `
        <div class="spread mb">
          <h3>交易流水</h3>
          <div class="row" style="gap:8px">
            <button class="btn ghost small" id="exportCsv">导出 CSV</button>
            <button class="btn primary small" id="addTrade">+ 新增交易</button>
          </div>
        </div>
        <div class="filters">
          <input id="tf_q" placeholder="搜索名称 / 代码 / 备注" value="${esc(q)}"/>
          <select id="tf_cat">
            <option value="">全部品类</option>
            <option value="stock">股票</option><option value="fund">基金</option>
            <option value="future">期货</option><option value="bond">债券</option><option value="other">其他</option>
          </select>
          <input id="tf_from" type="date" value="${esc(from)}"/>
          <input id="tf_to" type="date" value="${esc(to)}"/>
          <button class="btn small" id="tf_go">筛选</button>
        </div>
        ${rows.length ? tradeListHtml(rows) : emptyState('💱', '还没有交易', '点右上角「新增交易」，输入股票名就能搜索并记账。', '+ 记一笔', 'emptyAdd')}`;
      if ($('#tf_cat')) $('#tf_cat').value = category;
      const reload = () => renderTrades(root);
      $('#addTrade').onclick = () => openTradeForm();
      if ($('#emptyAdd')) $('#emptyAdd').onclick = () => openTradeForm();
      $('#tf_go').onclick = reload;
      $('#tf_q').onkeydown = e => { if (e.key === 'Enter') reload(); };
      $('#exportCsv').onclick = () => { window.location.href = 'api/pref/export.csv'; };
      bindTradeActions(root, reload);
    } catch (e) {
      console.error('[trades]', e);
      root.innerHTML = emptyState('⚠️', '加载失败', '请稍后重试');
    }
  }

  async function openTradeForm(existing) {
    const accounts = await Api.listAccounts().catch(() => ({ data: [] }));
    const accOpts = (accounts.data || []).map(a =>
      `<option value="${a.id}" ${(existing && String(existing.account_id) === String(a.id)) || (!existing && String(a.id) === localStorage.getItem('last_account')) ? 'selected' : ''}>${esc(a.name)}</option>`
    ).join('');
    const isEdit = !!(existing && existing.id);
    openModal(isEdit ? '编辑交易' : '记一笔交易', `
      <div class="field" style="position:relative"><label>标的名称 / 代码</label>
        <input id="t_sym_name" placeholder="贵州茅台、600519、AAPL" autocomplete="off" value="${esc(existing && existing.symbol_name)}"/>
        <div id="t_sym_suggest" class="sym-suggest"></div></div>
      <div class="row" style="gap:12px">
        <div class="field"><label>分类</label><select id="t_cat">
          <option value="stock">股票</option><option value="fund">基金</option>
          <option value="future">期货</option><option value="bond">债券</option>
          <option value="other">其他</option></select></div>
        <div class="field"><label>账户</label><select id="t_acc"><option value="">不指定</option>${accOpts}</select></div>
      </div>
      <div class="row" style="gap:12px">
        <div class="field"><label>动作</label><select id="t_act">
          <option value="open">开仓</option><option value="add">加仓</option>
          <option value="reduce">减仓</option><option value="close">平仓</option>
          <option value="dividend">分红</option><option value="fee">费用</option></select></div>
        <div class="field"><label>方向</label><select id="t_side"><option value="buy">买</option><option value="sell">卖</option></select></div>
      </div>
      <div class="row" style="gap:12px">
        <div class="field"><label>数量</label><input id="t_qty" type="number" step="any" inputmode="decimal" placeholder="股数 / 份数" value="${existing ? esc(existing.quantity) : ''}"/></div>
        <div class="field"><label>价格</label><input id="t_price" type="number" step="any" inputmode="decimal" placeholder="成交价" value="${existing ? esc(existing.price) : ''}"/></div>
      </div>
      <div class="amount-preview"><span class="muted">成交金额</span><b id="t_amt">¥0.00</b></div>
      <div class="row" style="gap:12px">
        <div class="field"><label>手续费</label><input id="t_fee" type="number" step="any" inputmode="decimal" value="${existing ? esc(existing.fee || 0) : '0'}"/></div>
        <div class="field"><label>时间</label><input id="t_dt" type="datetime-local" value="${toDatetimeLocal(existing ? existing.datetime : Date.now())}"/></div>
      </div>
      <div class="field"><label>备注</label><input id="t_note" placeholder="当时为什么买/卖，可选" value="${esc(existing && existing.note)}"/></div>
      <button class="btn primary block" id="t_submit">${isEdit ? '保存修改' : '保存交易'}</button>`);

    let selectedCode = (existing && (existing.symbol_code || '')) || '';
    let selectedMarket = (existing && (existing.symbol_market || existing.market || '')) || '';
    if (existing && existing.category) $('#t_cat').value = existing.category;
    if (existing && existing.action) $('#t_act').value = existing.action;
    if (existing && existing.side) $('#t_side').value = existing.side;

    const syncAmt = () => {
      const amt = (parseFloat($('#t_qty').value) || 0) * (parseFloat($('#t_price').value) || 0);
      $('#t_amt').textContent = fmtMoney(amt);
    };
    $('#t_qty').oninput = $('#t_price').oninput = syncAmt;
    syncAmt();
    $('#t_act').onchange = () => {
      const a = $('#t_act').value;
      if (a === 'open' || a === 'add') $('#t_side').value = 'buy';
      if (a === 'reduce' || a === 'close') $('#t_side').value = 'sell';
    };

    const suggestBox = $('#t_sym_suggest');
    let timer = null;
    $('#t_sym_name').oninput = () => {
      clearTimeout(timer);
      selectedCode = ''; selectedMarket = '';
      const val = $('#t_sym_name').value.trim();
      if (val.length < 1) { suggestBox.style.display = 'none'; return; }
      timer = setTimeout(async () => {
        try {
          const r = await Api.searchStock(val);
          if (!r.data || !r.data.length) { suggestBox.style.display = 'none'; return; }
          suggestBox.innerHTML = r.data.map(s =>
            `<div class="sym-item" data-code="${esc(s.code)}" data-market="${esc(s.market)}" data-cat="${esc(s.category)}" data-name="${esc(s.name)}">
              <span><b>${esc(s.name)}</b> <span class="muted">${esc(s.code)}</span></span>
              <span class="badge blue">${labelCat(s.category || 'stock')}${s.market ? ' · ' + s.market : ''}</span></div>`
          ).join('');
          suggestBox.style.display = 'block';
          $$('.sym-item', suggestBox).forEach(el => el.onclick = () => {
            $('#t_sym_name').value = el.dataset.name;
            selectedCode = el.dataset.code;
            selectedMarket = el.dataset.market;
            if (el.dataset.cat && $(`#t_cat option[value="${el.dataset.cat}"]`)) $('#t_cat').value = el.dataset.cat;
            suggestBox.style.display = 'none';
            fetchAndFillPrice(selectedCode, selectedMarket);
          });
        } catch { suggestBox.style.display = 'none'; }
      }, 280);
    };
    $('#t_sym_name').onblur = () => setTimeout(() => { suggestBox.style.display = 'none'; }, 220);

    async function fetchAndFillPrice(code, market) {
      if (!code) return;
      try {
        const r = await Api.realtimePrice(code, market);
        if (r.code === 0 && r.data.price != null) {
          $('#t_price').value = Number(r.data.price).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
          syncAmt();
          toast('已填入最新价 ' + fmtMoney(r.data.price), 'ok');
        }
      } catch { /* ignore */ }
    }

    $('#t_submit').onclick = async () => {
      const acc = $('#t_acc').value;
      if (acc) localStorage.setItem('last_account', acc);
      const body = {
        id: existing && existing.id,
        symbol_id: existing && existing.symbol_id,
        symbol_name: $('#t_sym_name').value.trim(),
        symbol_code: selectedCode,
        market: selectedMarket,
        category: $('#t_cat').value,
        account_id: acc || null,
        action: $('#t_act').value, side: $('#t_side').value,
        quantity: $('#t_qty').value, price: $('#t_price').value, fee: $('#t_fee').value || 0,
        datetime: $('#t_dt').value ? new Date($('#t_dt').value).getTime() : Date.now(),
        note: $('#t_note').value
      };
      if (!body.symbol_name) return toast('请输入标的名称', 'err');
      const r = await guard(isEdit ? Api.updateTrade(existing.id, body) : Api.addTrade(body));
      if (r.code === 0) {
        closeModal();
        toast(isEdit ? '已保存修改' : '已记下一笔', 'ok');
        if (state.route === 'trades') renderTrades($('#content'));
        else if (state.route === 'dashboard') renderDashboard($('#content'));
        else if (state.route === 'positions') renderPositions($('#content'));
      }
    };
  }

  async function renderPositions(root) {
    try {
      const ov = await Api.overview();
      const positions = (ov.data && ov.data.positions || []).filter(p => p.qty > 0);
      const closed = (ov.data && ov.data.positions || []).filter(p => p.qty <= 0 && p.realized);
      root.innerHTML = `
        <div class="spread mb">
          <h3>当前持仓</h3>
          <button class="btn primary small" id="posRefresh" ${positions.length ? '' : 'disabled'}>一键刷新行情</button>
        </div>
        ${positions.length ? `
          <div class="pos-list mobile-only">${positions.map(posCard).join('')}</div>
          <div class="card desktop-only"><div class="table-wrap"><table class="table">
            <tr><th>标的</th><th>品类</th><th>数量</th><th>成本</th><th>现价</th><th>市值</th><th>浮动</th><th>收益率</th><th></th></tr>
            ${positions.map(p => `<tr>
              <td>${esc(p.name)}${p.code ? '<div class="muted" style="font-size:11px">' + esc(p.code) + '</div>' : ''}</td>
              <td>${labelCat(p.category)}</td>
              <td>${fmt(p.qty, 3)}</td><td>${fmt(p.avg_cost)}</td>
              <td><div class="row" style="gap:4px;align-items:center;flex-wrap:nowrap">
                <input style="width:92px" type="number" step="any" inputmode="decimal" value="${p.market_price == null ? '' : p.market_price}" data-price="${p.symbol_id}" placeholder="市价"/>
                ${p.code ? `<button class="btn small ghost" data-rt="${p.symbol_id}" data-code="${esc(p.code)}" data-mkt="${esc(p.market || '')}">行情</button>` : ''}
              </div></td>
              <td>${fmtMoney(p.market_value)}</td>
              <td class="${pnlClass(p.float_pnl)}">${p.float_pnl == null ? '-' : fmtSigned(p.float_pnl)}</td>
              <td class="${pnlClass(p.pnl_pct)}">${p.pnl_pct == null ? '-' : p.pnl_pct + '%'}</td>
              <td>
                <button class="btn small" data-set="${p.symbol_id}">更新</button>
                <button class="btn small ghost" data-alert="${p.symbol_id}">提醒</button>
              </td>
            </tr>`).join('')}
          </table></div></div>` : emptyState('📈', '当前没有持仓', '买入并记账后，持仓会自动出现。也可以先去记一笔开仓。', '去记账', 'posAdd')}
        ${closed.length ? `<div class="section-head"><h3 class="section-title">已清仓（仍有已实现盈亏）</h3></div>
          <div class="card"><div class="muted">${closed.map(p => `${esc(p.name)} ${fmtSigned(p.realized)}`).join(' · ')}</div></div>` : ''}`;
      if ($('#posAdd')) $('#posAdd').onclick = () => openTradeForm();
      if ($('#posRefresh')) $('#posRefresh').onclick = () => refreshQuotes(renderPositions);
      $$('[data-set]', root).forEach(b => b.onclick = () => savePrice(b.dataset.set));
      $$('[data-rt]', root).forEach(btn => btn.onclick = () => fillQuote(btn));
      $$('[data-alert]', root).forEach(b => b.onclick = () => openRuleForm(b.dataset.alert));
      $$('[data-save]', root).forEach(b => b.onclick = () => savePrice(b.dataset.save));
    } catch (e) {
      console.error('[positions]', e);
      root.innerHTML = emptyState('⚠️', '加载失败', '请稍后重试');
    }
  }

  function posCard(p) {
    const pct = Math.min(100, Math.abs(p.pnl_pct || 0));
    const color = p.pnl_pct > 0 ? 'var(--success)' : p.pnl_pct < 0 ? 'var(--danger)' : 'var(--border)';
    return `<div class="pos-card">
      <div class="t-top">
        <div>
          <div class="t-name">${esc(p.name)} <span class="muted">${esc(p.code || '')}</span></div>
          <div class="t-meta">${labelCat(p.category)} · ${fmt(p.qty, 3)} 股/份 · 成本 ${fmt(p.avg_cost)}</div>
        </div>
        <div class="t-amt ${pnlClass(p.float_pnl)}">${p.float_pnl == null ? '未报价' : fmtSigned(p.float_pnl)}
          <div class="muted" style="font-weight:500">${p.pnl_pct == null ? '' : p.pnl_pct + '%'}</div></div>
      </div>
      <div class="row mt" style="gap:6px;align-items:center">
        <input type="number" step="any" inputmode="decimal" value="${p.market_price == null ? '' : p.market_price}" data-price="${p.symbol_id}" placeholder="现价"/>
        ${p.code ? `<button class="btn small ghost" data-rt="${p.symbol_id}" data-code="${esc(p.code)}" data-mkt="${esc(p.market || '')}">行情</button>` : ''}
      </div>
      <div class="pnl-bar"><span style="width:${pct}%;background:${color}"></span></div>
      <div class="pos-actions">
        <button class="btn small" data-save="${p.symbol_id}">更新市价</button>
        <button class="btn small ghost" data-alert="${p.symbol_id}">设提醒</button>
      </div>
    </div>`;
  }

  async function savePrice(id) {
    const inp = visibleInput(`[data-price="${id}"]`);
    if (!inp || inp.value === '') return toast('请先录入市价', 'err');
    await guard(Api.setPrice(id, inp.value));
    toast('市价已更新', 'ok');
    renderPositions($('#content'));
  }

  function visibleInput(selector) {
    return $$(selector).find(n => n.offsetParent !== null) || $(selector);
  }

  async function fillQuote(btn) {
    btn.disabled = true; const old = btn.textContent; btn.textContent = '…';
    try {
      const r = await Api.realtimePrice(btn.dataset.code, btn.dataset.mkt);
      if (r.code === 0 && r.data.price != null) {
        const inp = visibleInput(`[data-price="${btn.dataset.rt}"]`);
        if (inp) inp.value = r.data.price;
        toast(`${btn.dataset.code} 最新价 ${fmtMoney(r.data.price)}`, 'ok');
      } else toast((r.data && r.data.error) || '未获取到行情', 'err');
    } catch { toast('请求失败', 'err'); }
    finally { btn.disabled = false; btn.textContent = old; }
  }

  async function renderAlerts(root) {
    try {
      const [syms, rules, logs] = await Promise.all([Api.listSymbols(), Api.listRules(), Api.listLogs()]);
      const pending = (logs.data || []).filter(l => !l.handled);
      root.innerHTML = `
        <div class="spread mb"><h3>提醒规则</h3><button class="btn primary small" id="addRule">+ 新增规则</button></div>
        <div class="card mb">${(rules.data || []).length ? `<div class="table-wrap"><table class="table">
          <tr><th>标的</th><th>类型</th><th>条件</th><th>状态</th><th></th></tr>
          ${(rules.data || []).map(r => `<tr>
            <td>${esc(r.symbol_name)}</td>
            <td><span class="badge ${r.type === 'stop_profit' ? 'green' : 'red'}">${r.type === 'stop_profit' ? '止盈' : '止损'}</span></td>
            <td>${r.mode === 'percent' ? (r.type === 'stop_profit' ? '+' : '−') + r.threshold + '%' : '价格 ' + r.threshold}</td>
            <td>${r.status === 'active' ? '<span class="badge green">启用</span>' : '<span class="badge">暂停</span>'}</td>
            <td>
              <button class="btn small ghost" data-toggle="${r.id}" data-st="${r.status}">${r.status === 'active' ? '暂停' : '启用'}</button>
              <button class="btn small ghost" data-delr="${r.id}">删</button>
            </td></tr>`).join('')}
        </table></div>` : '<div class="muted">还没有规则。建议对重仓标的先设一个止损。</div>'}</div>
        <div class="spread mb">
          <h3>提醒中心 ${pending.length ? `<span class="nav-badge" style="position:static;display:inline-block">${pending.length}</span>` : ''}</h3>
          <div class="row" style="gap:8px">
            ${pending.length ? '<button class="btn ghost small" id="handleAll">全部已处理</button>' : ''}
            <button class="btn small" id="btnCheck">立即检查</button>
          </div>
        </div>
        <div class="card">${(logs.data || []).length ? `<div class="table-wrap"><table class="table">
          <tr><th>时间</th><th>内容</th><th>状态</th><th></th></tr>
          ${(logs.data || []).map(l => `<tr>
            <td>${fmtDateTime(l.triggered_at)}</td>
            <td>${esc(l.message)}</td>
            <td>${l.handled ? '<span class="badge">已处理</span>' : '<span class="badge red">未处理</span>'}</td>
            <td>${l.handled ? '' : '<button class="btn small" data-handle="' + l.id + '">标记已处理</button>'}</td>
          </tr>`).join('')}
        </table></div>` : '<div class="muted">暂无提醒。更新持仓市价后点「立即检查」。</div>'}</div>`;
      $('#addRule').onclick = () => openRuleForm(null, syms.data || []);
      $$('[data-delr]', root).forEach(b => b.onclick = async () => {
        if (await confirmDialog('删除该规则？')) { await guard(Api.delRule(b.dataset.delr)); renderAlerts(root); }
      });
      $$('[data-toggle]', root).forEach(b => b.onclick = async () => {
        const next = b.dataset.st === 'active' ? 'paused' : 'active';
        await guard(Api.toggleRule(b.dataset.toggle, next));
        renderAlerts(root);
      });
      $$('[data-handle]', root).forEach(b => b.onclick = async () => {
        await guard(Api.handleLog(b.dataset.handle));
        await refreshUnread();
        renderAlerts(root);
      });
      if ($('#handleAll')) $('#handleAll').onclick = async () => {
        await guard(Api.handleAllLogs()); await refreshUnread(); renderAlerts(root);
      };
      $('#btnCheck').onclick = async () => {
        const r = await guard(Api.checkAlerts());
        toast(r.code === 0 ? (r.data.length ? '触发 ' + r.data.length + ' 条提醒' : '未触发新提醒') : '检查失败', r.code === 0 ? 'ok' : 'err');
        await refreshUnread();
        renderAlerts(root);
      };
    } catch (e) {
      console.error('[alerts]', e);
      root.innerHTML = emptyState('⚠️', '加载失败', '请稍后重试');
    }
  }

  async function openRuleForm(symbolId, symbols) {
    let syms = symbols;
    if (!syms) {
      const r = await Api.listSymbols();
      syms = r.data || [];
    }
    const holdings = (await Api.overview()).data.positions.filter(p => p.qty > 0);
    const prefer = holdings.length ? holdings : syms;
    const opts = prefer.map(s => {
      const id = s.symbol_id || s.id;
      const name = s.name || s.symbol_name;
      const code = s.code || '';
      return `<option value="${id}" ${String(id) === String(symbolId) ? 'selected' : ''}>${esc(name)}${code ? ' (' + esc(code) + ')' : ''}</option>`;
    }).join('');
    openModal('新增止盈止损规则', `
      <p class="muted" style="margin-bottom:8px">按成本涨跌幅，或按绝对价格触发。同一规则 24 小时内只提醒一次。</p>
      <div class="field"><label>标的</label><select id="r_sym">${opts || '<option value="">请先记账产生标的</option>'}</select></div>
      <div class="row" style="gap:12px">
        <div class="field"><label>类型</label><select id="r_type"><option value="stop_loss">止损</option><option value="stop_profit">止盈</option></select></div>
        <div class="field"><label>模式</label><select id="r_mode"><option value="percent">涨跌幅 %</option><option value="price">价格</option></select></div>
      </div>
      <div class="field"><label id="r_th_label">阈值（例如 8 表示下跌 8% 时提醒）</label><input id="r_th" type="number" step="any" inputmode="decimal" placeholder="8"/></div>
      <button class="btn primary block" id="r_submit">保存规则</button>`);
    const syncLabel = () => {
      const profit = $('#r_type').value === 'stop_profit';
      const pct = $('#r_mode').value === 'percent';
      $('#r_th_label').textContent = pct
        ? (profit ? '阈值（例如 20 表示上涨 20% 提醒）' : '阈值（例如 8 表示下跌 8% 提醒）')
        : (profit ? '触发价格（现价达到或超过）' : '触发价格（现价跌到或低于）');
    };
    $('#r_type').onchange = $('#r_mode').onchange = syncLabel;
    $('#r_submit').onclick = async () => {
      const r = await guard(Api.addRule({
        symbol_id: parseInt($('#r_sym').value, 10), type: $('#r_type').value,
        mode: $('#r_mode').value, threshold: $('#r_th').value
      }));
      if (r.code === 0) {
        closeModal();
        toast('规则已保存', 'ok');
        if (state.route === 'alerts') renderAlerts($('#content'));
      }
    };
  }

  function weekRange() {
    const now = new Date();
    const day = (now.getDay() + 6) % 7;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
    const end = new Date(start); end.setDate(start.getDate() + 6);
    return [isoDate(start), isoDate(end)];
  }
  function monthRange() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return [isoDate(start), isoDate(end)];
  }

  async function renderReviews(root) {
    try {
      const [list, tpl] = await Promise.all([Api.listReviews(), Api.reviewTemplate()]);
      const fields = (tpl.data && tpl.data.fields) || [];
      const items = list.data || [];
      root.innerHTML = `
        <div class="spread mb"><h3>投资复盘</h3><button class="btn primary small" id="addReview">+ 新建复盘</button></div>
        ${items.length ? `<div class="grid">${items.map(r => {
          const c = r.content || {};
          return `<div class="card">
            <div class="spread mb"><span class="badge blue">${ptype(r.period_type)}</span>
              <span class="muted">${fmtDate(r.start_date)} ~ ${fmtDate(r.end_date)}</span></div>
            ${fields.map(f => c[f.key] ? `<div class="mb"><div class="muted" style="font-size:12px">${f.label}</div><div>${esc(c[f.key])}</div></div>` : '').join('')}
            <div class="row" style="justify-content:flex-end;gap:8px;margin-top:8px">
              <button class="btn small ghost" data-editr="${r.id}">编辑</button>
              <button class="btn small ghost" data-del="${r.id}">删除</button></div>
          </div>`;
        }).join('')}</div>` : emptyState('📝', '还没有复盘', '建议每周花 10 分钟，对照真实交易问自己：当时为什么这么做。', '写一篇本周复盘', 'emptyReview')}`;
      const open = (row) => openReviewForm(fields, row);
      if ($('#addReview')) $('#addReview').onclick = () => open(null);
      if ($('#emptyReview')) $('#emptyReview').onclick = () => open({ period_type: 'week' });
      $$('[data-del]', root).forEach(b => b.onclick = async () => {
        if (await confirmDialog('删除该复盘？')) { await guard(Api.delReview(b.dataset.del)); renderReviews(root); }
      });
      $$('[data-editr]', root).forEach(b => {
        const row = items.find(x => String(x.id) === String(b.dataset.editr));
        b.onclick = () => open(row);
      });
    } catch (e) {
      console.error('[reviews]', e);
      root.innerHTML = emptyState('⚠️', '加载失败', '请稍后重试');
    }
  }

  function openReviewForm(fields, existing) {
    const isEdit = !!(existing && existing.id);
    const [ws, we] = weekRange();
    const [ms, me] = monthRange();
    const type0 = (existing && existing.period_type) || 'week';
    let sd = existing ? isoDate(new Date(existing.start_date)) : ws;
    let ed = existing ? isoDate(new Date(existing.end_date)) : we;
    const content = (existing && existing.content) || {};
    const fieldsHtml = fields.map(f => `<div class="field"><label>${f.label}<span class="muted"> · ${f.hint || ''}</span></label>
      <textarea id="rv_${f.key}" rows="3">${esc(content[f.key] || '')}</textarea></div>`).join('');
    openModal(isEdit ? '编辑复盘' : '新建复盘', `
      <div class="row" style="gap:12px">
        <div class="field"><label>周期</label>
          <select id="rv_type">
            <option value="week">本周 / 周复盘</option>
            <option value="month">本月 / 月复盘</option>
            <option value="custom">自定义</option>
          </select></div>
      </div>
      <div class="row" style="gap:12px">
        <div class="field"><label>开始</label><input id="rv_sd" type="date" value="${sd}"/></div>
        <div class="field"><label>结束</label><input id="rv_ed" type="date" value="${ed}"/></div>
      </div>
      <button class="btn ghost block" id="rv_load" style="margin-top:10px">带入该区间交易</button>
      <div id="rv_insight" class="muted" style="margin-top:8px"></div>
      ${fieldsHtml}
      <button class="btn primary block" id="rv_submit">${isEdit ? '保存修改' : '保存复盘'}</button>`);
    $('#rv_type').value = type0;
    const applyType = () => {
      const t = $('#rv_type').value;
      if (t === 'week') { $('#rv_sd').value = ws; $('#rv_ed').value = we; }
      if (t === 'month') { $('#rv_sd').value = ms; $('#rv_ed').value = me; }
    };
    if (!isEdit) applyType();
    $('#rv_type').onchange = applyType;

    const fillInsight = async () => {
      const start = $('#rv_sd').value, end = $('#rv_ed').value;
      if (!start || !end) return toast('请先选择日期', 'err');
      const r = await guard(Api.periodInsight(start, end));
      if (r.code !== 0) return;
      const d = r.data.discipline || {};
      const trades = r.data.trades || [];
      const lines = trades.map(t =>
        `${fmtDay(t.datetime)} ${t.side === 'buy' ? '买' : '卖'} ${t.symbol_name} ${fmt(t.quantity)} @ ${fmt(t.price)}`
      );
      $('#rv_insight').innerHTML = trades.length
        ? `本期 ${trades.length} 笔，买入 ${d.buy_count} / 卖出 ${d.sell_count}，已实现 ${fmtSigned(d.realized)}，胜率 ${d.win_rate == null ? '-' : d.win_rate + '%'}`
        : '该区间没有交易记录';
      if (lines.length && !$('#rv_operations').value.trim()) $('#rv_operations').value = lines.join('\n');
    };
    $('#rv_load').onclick = fillInsight;
    if (!isEdit) fillInsight();

    $('#rv_submit').onclick = async () => {
      const contentBody = {};
      fields.forEach(f => contentBody[f.key] = $('#rv_' + f.key).value);
      const body = {
        period_type: $('#rv_type').value,
        start_date: $('#rv_sd').value,
        end_date: $('#rv_ed').value,
        content: contentBody
      };
      const r = await guard(isEdit ? Api.updateReview(existing.id, body) : Api.addReview(body));
      if (r.code === 0) { closeModal(); toast('复盘已保存', 'ok'); renderReviews($('#content')); }
    };
  }

  async function renderProfile(root) {
    try {
      const [pref, accounts] = await Promise.all([Api.getPref(), Api.listAccounts()]);
      const theme = (pref.data && pref.data.theme) || 'dark';
      const accs = accounts.data || [];
      root.innerHTML = `
        <div class="grid cols-2">
          <div class="card">
            <h3 class="mb">账号</h3>
            <p>当前用户：<b>${esc(state.user.username)}</b></p>
            <p class="muted mt">注册于 ${state.user.created_at ? fmtDate(state.user.created_at) : '-'}</p>
            <div class="field mt"><label>修改密码</label>
              <input id="op" type="password" placeholder="原密码" autocomplete="current-password"/></div>
            <div class="field"><input id="np" type="password" placeholder="新密码（8 位以上，含字母数字）" autocomplete="new-password"/></div>
            <button class="btn primary block" id="chg">保存新密码</button>
          </div>
          <div class="card">
            <h3 class="mb">交易账户</h3>
            <p class="muted mb">用来区分券商、基金 App、期货账户。</p>
            ${(accs).map(a => `<div class="spread" style="padding:8px 0;border-bottom:1px solid var(--border)">
              <div><b>${esc(a.name)}</b> <span class="muted">${esc(a.broker || '')}</span></div>
              <button class="btn small ghost" data-dela="${a.id}">删除</button>
            </div>`).join('') || '<div class="muted">还没有账户</div>'}
            <div class="row mt" style="gap:8px">
              <input id="acc_name" placeholder="账户名，如 华泰证券"/>
              <button class="btn small" id="acc_add">添加</button>
            </div>
          </div>
          <div class="card">
            <h3 class="mb">外观</h3>
            <div class="theme-grid" id="profileThemes"></div>
          </div>
          <div class="card">
            <h3 class="mb">数据备份</h3>
            <div class="row" style="gap:8px">
              <button class="btn" id="exportBtn">导出 JSON</button>
              <button class="btn ghost" id="exportCsv2">导出交易 CSV</button>
              <button class="btn ghost" id="importBtn">导入备份</button>
            </div>
            <input id="importFile" type="file" accept="application/json" hidden/>
            <p class="muted mt">JSON 可完整备份账户、标的、交易、提醒和复盘；CSV 方便对账或报税。</p>
            <p class="muted mt">本工具为个人投资记录辅助，不构成任何投资建议。</p>
          </div>
        </div>`;
      renderThemeGrid($('#profileThemes'), theme);
      $('#chg').onclick = async () => {
        const r = await guard(Api.changePwd($('#op').value, $('#np').value));
        if (r.code === 0) { toast('密码已修改', 'ok'); $('#op').value = $('#np').value = ''; }
      };
      $('#acc_add').onclick = async () => {
        const name = $('#acc_name').value.trim();
        if (!name) return toast('请填写账户名', 'err');
        const r = await guard(Api.addAccount({ name }));
        if (r.code === 0) { toast('已添加账户', 'ok'); renderProfile(root); }
      };
      $$('[data-dela]', root).forEach(b => b.onclick = async () => {
        if (await confirmDialog('删除账户不会删除交易，仅取消关联。确定？')) {
          await guard(Api.delAccount(b.dataset.dela));
          renderProfile(root);
        }
      });
      $('#exportBtn').onclick = async () => {
        const r = await Api.exportData();
        if (r.code === 0) {
          const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
          a.download = 'investment-diary-export.json'; a.click();
        } else toast('导出失败', 'err');
      };
      $('#exportCsv2').onclick = () => { window.location.href = 'api/pref/export.csv'; };
      $('#importBtn').onclick = () => $('#importFile').click();
      $('#importFile').onchange = async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          const json = JSON.parse(await file.text());
          if (!(await confirmDialog('导入会把备份中的数据追加到当前账号，不会覆盖已有记录。确定导入？'))) return;
          const r = await guard(Api.importData(json.data || json));
          if (r.code === 0) toast(`已导入交易 ${r.data.trades} 笔`, 'ok');
        } catch { toast('文件无法解析', 'err'); }
      };
    } catch (e) {
      console.error('[profile]', e);
      root.innerHTML = emptyState('⚠️', '加载失败', '请稍后重试');
    }
  }

  function renderThemeGrid(container, current) {
    container.innerHTML = Theme.THEMES.map(t => `<div class="theme-item ${t.id === current ? 'active' : ''}" data-theme="${t.id}">
      <div style="height:54px;border-radius:10px;background:${t.preview};border:1px solid var(--border)"></div>
      <div class="muted" style="font-size:12px;margin-top:4px">${t.name}</div></div>`).join('');
    $$('.theme-item', container).forEach(el => el.onclick = () => {
      Theme.set(el.dataset.theme);
      $$('.theme-item', container).forEach(x => x.classList.toggle('active', x.dataset.theme === el.dataset.theme));
    });
  }

  function setupThemeUI() {
    const open = async () => {
      const p = await Api.getPref().catch(() => ({ data: { theme: Theme.localTheme } }));
      renderThemeGrid($('#themeGrid'), (p.data && p.data.theme) || 'dark');
      $('#themeModal').hidden = false;
    };
    $('#themeBtn').onclick = open;
    $('#themeBtn2').onclick = open;
    $('#themeClose').onclick = () => ($('#themeModal').hidden = true);
  }

  function bindGlobal() {
    $('#formClose').onclick = closeModal;
    $('#logoutBtn').onclick = async () => {
      await Api.logout();
      state.user = null;
      state.unread = 0;
      location.hash = '#/login';
    };
    $('#quickAdd').onclick = () => openTradeForm();
    $('#fabAdd').onclick = () => openTradeForm();
    $$('.modal-mask').forEach(mask => mask.addEventListener('click', e => {
      if (e.target === mask) mask.hidden = true;
    }));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeModal(); $('#themeModal').hidden = true; }
    });
  }

  async function boot() {
    try {
      await Theme.init();
      setupThemeUI();
      bindGlobal();
      window.addEventListener('hashchange', route);
      await route();
    } catch (e) {
      console.error('[boot]', e);
      document.getElementById('content').innerHTML = `<div class="empty"><div class="big">⚠️</div><p>应用初始化失败，请刷新页面</p><button class="btn primary mt" onclick="location.reload()">刷新</button></div>`;
    }
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
