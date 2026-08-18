// app.js - 单页应用：路由、页面渲染、交互
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const fmt = (n, d = 2) => (n == null ? '-' : Number(n).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d }));
  const fmtMoney = (n) => '¥' + fmt(n);
  const pnlClass = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = { user: null, route: 'dashboard' };
  const ROUTES = [
    { key: 'dashboard', label: '总览', ico: '📊', title: '总览' },
    { key: 'trades', label: '交易记录', ico: '💱', title: '交易记录' },
    { key: 'positions', label: '持仓', ico: '📈', title: '当前持仓' },
    { key: 'alerts', label: '止盈止损', ico: '🔔', title: '止盈止损提醒' },
    { key: 'reviews', label: '复盘', ico: '📝', title: '投资复盘' },
    { key: 'profile', label: '我的', ico: '👤', title: '我的' },
  ];

  // ---------- 工具 ----------
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), 2200);
  }
  async function guard(p) { const r = await p; if (r.code === 1 && r.message) toast(r.message); return r; }

  function openModal(title, bodyHtml) {
    if (!bodyHtml) bodyHtml = '<p class="muted">内容加载中…</p>';
    $('#formTitle').textContent = title; $('#formBody').innerHTML = bodyHtml;
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

  // 简单 SVG 折线图
  function lineChart(values, labels) {
    if (!values.length) return '<div class="muted">暂无数据</div>';
    const w = 520, h = 160, pad = 24;
    const max = Math.max(...values, 0), min = Math.min(...values, 0);
    const range = (max - min) || 1;
    const x = i => pad + (i * (w - pad * 2)) / (values.length - 1 || 1);
    const y = v => h - pad - ((v - min) / range) * (h - pad * 2);
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const area = `${pad},${h - pad} ${pts} ${w - pad},${h - pad}`;
    const zero = y(0);
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-width:${w}px">
      <polygon points="${area}" fill="var(--primary)" opacity=".12"/>
      <line x1="${pad}" y1="${zero}" x2="${w - pad}" y2="${zero}" stroke="var(--border)"/>
      <polyline points="${pts}" fill="none" stroke="var(--primary)" stroke-width="2"/>
    </svg>`;
  }
  function pieChart(data) {
    if (!data.length) return '<div class="muted">暂无数据</div>';
    const total = data.reduce((s, d) => s + Math.abs(d.market || 0), 0) || 1;
    const colors = ['#4f46e5', '#16a34a', '#f59e0b'];
    let ang = 0; const r = 60, cx = 70, cy = 70;
    const segs = data.map((d, i) => {
      const frac = Math.abs(d.market || 0) / total;
      const a2 = ang + frac * 2 * Math.PI;
      const x1 = cx + r * Math.cos(ang), y1 = cy + r * Math.sin(ang);
      const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
      const large = frac > 0.5 ? 1 : 0;
      ang = a2;
      return `<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${colors[i % 3]}"/>`;
    }).join('');
    const legend = data.map((d, i) => `<div class="row" style="gap:6px"><span style="width:12px;height:12px;border-radius:3px;background:${colors[i % 3]}"></span>${labelCat(d.category)} ${fmtMoney(d.market)}</div>`).join('');
    return `<div class="row" style="gap:16px;align-items:center"><svg width="140" height="140" viewBox="0 0 140 140">${segs}</svg><div>${legend}</div></div>`;
  }
  const labelCat = (c) => ({ stock: '股票', fund: '基金', future: '期货', bond: '债券' }[c] || c);

  // ---------- 导航 ----------
  function renderNav() {
    const side = $('#sideNav'), bottom = $('#bottomNav');
    side.innerHTML = ROUTES.map(r => `<a class="nav-item ${r.key === state.route ? 'active' : ''}" href="#/${r.key}" data-route="${r.key}">${r.ico} ${r.label}</a>`).join('');
    bottom.innerHTML = ROUTES.map(r => `<a class="nav-item ${r.key === state.route ? 'active' : ''}" href="#/${r.key}" data-route="${r.key}"><span class="ico">${r.ico}</span>${r.label}</a>`).join('');
    const cur = ROUTES.find(r => r.key === state.route);
    if (cur) $('#pageTitle').textContent = cur.title;
    if (state.user) { $('#logoutBtn').style.display = ''; }
  }

  // ---------- 路由 ----------
  const PAGES = {
    dashboard: renderDashboard, trades: renderTrades, positions: renderPositions,
    alerts: renderAlerts, reviews: renderReviews, profile: renderProfile,
    login: renderLogin
  };
  async function route() {
    try {
      const hash = location.hash.replace('#/', '') || 'dashboard';
      state.route = (ROUTES.some(r => r.key === hash) || hash === 'login') ? hash : 'dashboard';
      // 已登录却访问登录页 -> 跳总览
      if (state.user && state.route === 'login') { location.hash = '#/dashboard'; return; }
      if (!state.user && state.route !== 'login') {
        const me = await Api.me(); // 静默探测，不弹 toast
        if (me.code === 0) { state.user = me.data; }
        else { location.hash = '#/login'; return; }
      }
      renderNav();
      const fn = PAGES[state.route] || renderDashboard;
      $('#content').innerHTML = '<div class="empty"><div class="big">⏳</div>加载中…</div>';
      await fn($('#content'));
    } catch (e) {
      console.error('[route]', e);
      $('#content').innerHTML = `<div class="empty"><div class="big">⚠️</div><p>页面加载出错</p><button class="btn mt" onclick="location.reload()">刷新页面</button></div>`;
    }
  }

  // ---------- 登录 ----------
  function renderLogin(root) {
    $('#sidebar').style.display = 'none';
    document.querySelector('.bottom-nav').style.display = 'none';
    $('#logoutBtn').style.display = 'none';
    document.querySelector('.topbar').style.display = 'none';
    root.innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <div class="login-logo">📈</div>
          <div class="login-title">投资日记</div>
          <div class="login-sub">记录每一笔投资，复盘每一次决策</div>
          <div class="field"><label>用户名</label><input id="lu" autocomplete="username" placeholder="3-20 位字母数字下划线"/></div>
          <div class="field"><label>密码</label><input id="lp" type="password" autocomplete="current-password" placeholder="至少 8 位含字母和数字"/></div>
          <button class="btn block" id="doLogin">登录</button>
          <p class="muted mt" style="text-align:center">还没有账号？<a href="#" id="toReg">注册</a></p>
        </div>
      </div>`;
    const doLogin = async () => {
      const r = await guard(Api.login($('#lu').value.trim(), $('#lp').value));
      if (r.code === 0) { state.user = r.data; await afterAuth(); }
    };
    $('#doLogin').onclick = doLogin;
    $('#lp').onkeydown = e => { if (e.key === 'Enter') doLogin(); };
    $('#toReg').onclick = (e) => { e.preventDefault(); openReg(root); };
  }
  function openReg(root) {
    openModal('注册新账号', `<div class="field"><label>用户名</label><input id="ru"/></div>
      <div class="field"><label>密码</label><input id="rp" type="password" placeholder="至少 8 位含字母和数字"/></div>
      <button class="btn block" id="doReg">注册并登录</button>`);
    $('#doReg').onclick = async () => {
      const r = await guard(Api.register($('#ru').value.trim(), $('#rp').value));
      if (r.code === 0) { closeModal(); state.user = r.data; await afterAuth(); }
    };
  }
  async function afterAuth() {
    $('#sidebar').style.display = '';
    document.querySelector('.bottom-nav').style.display = '';
    document.querySelector('.topbar').style.display = '';
    const pref = await Api.getPref().catch(() => null);
    if (pref && pref.data) Theme.set(pref.data.theme); else Theme.apply(Theme.localTheme || 'light');
    location.hash = '#/dashboard';
  }

  // ---------- 总览 ----------
  async function renderDashboard(root) {
    try {
      const [ov, rank, trend] = await Promise.all([Api.overview(), Api.ranking(), Api.trend()]);
      if (ov.code !== 0) { root.innerHTML = `<div class="empty"><div class="big">⚠️</div><p>${esc(ov.message || '数据加载失败')}</p><button class="btn mt" onclick="location.reload()">刷新</button></div>`; return; }
      const o = ov.data.overview;
    root.innerHTML = `
      <div class="grid cols-4">
        ${statCard('总投入', fmtMoney(o.invested))}
        ${statCard('持仓市值', fmtMoney(o.market_value))}
        ${statCard('浮动盈亏', fmtMoney(o.float_pnl), pnlClass(o.float_pnl))}
        ${statCard('累计收益', fmtMoney(o.total_pnl), pnlClass(o.total_pnl))}
        ${statCard('已实现', fmtMoney(o.realized))}
        ${statCard('收益率', (o.total_return || 0) + '%', pnlClass(o.total_return))}
        ${statCard('持仓数', o.positions_count + ' 个')}
        <div class="stat"><div class="label">快捷操作</div><div class="mt"><button class="btn small" onclick="location.hash='#/trades'">+ 记一笔</button> <button class="btn small ghost" onclick="location.hash='#/alerts';setTimeout(()=>document.getElementById('btnCheck')&&document.getElementById('btnCheck').click(),300)">检查提醒</button></div></div>
      </div>
      <div class="grid cols-2 mt">
        <div class="card"><h3 class="mb">盈亏走势（按月·已实现）</h3>${lineChart(trend.data.values, trend.data.labels)}</div>
        <div class="card"><h3 class="mb">品类分布（市值）</h3>${pieChart(ov.data.categoryData)}</div>
      </div>
      <div class="grid cols-2 mt">
        <div class="card"><h3 class="mb">盈利榜</h3>${rankList(rank.data.profit)}</div>
        <div class="card"><h3 class="mb">亏损榜</h3>${rankList(rank.data.loss)}</div>
      </div>`;
    } catch (e) {
      console.error('[dashboard]', e);
      root.innerHTML = `<div class="empty"><div class="big">⚠️</div><p>页面加载出错，请刷新重试</p><button class="btn mt" onclick="location.reload()">刷新</button></div>`;
    }
  }
  function statCard(label, value, cls = '') {
    return `<div class="stat"><div class="label">${label}</div><div class="value ${cls}">${value}</div></div>`;
  }
  function rankList(arr) {
    if (!arr.length) return '<div class="muted">暂无持仓标的</div>';
    return `<table class="table"><tr><th>标的</th><th>浮动</th><th>收益率</th></tr>` +
      arr.slice(0, 5).map(r => `<tr><td>${esc(r.name)}${r.code ? '(' + esc(r.code) + ')' : ''}</td>
        <td class="${pnlClass(r.float)}">${fmtMoney(r.float)}</td><td class="${pnlClass(r.pnl_pct)}">${r.pnl_pct == null ? '-' : r.pnl_pct + '%'}</td></tr>`).join('') + '</table>';
  }

  // ---------- 交易记录 ----------
  async function renderTrades(root) {
    try {
      const [syms, trades] = await Promise.all([Api.listSymbols(), Api.listTrades()]);
      const symOpts = (syms.data || []).map(s => `<option value="${s.id}">${esc(s.name)}${s.code ? '(' + esc(s.code) + ')' : ''}</option>`).join('');
      root.innerHTML = `
        <div class="spread mb"><h3>交易流水</h3><button class="btn small" id="addTrade">+ 新增交易</button></div>
        <div class="card">
          <table class="table" id="tradeTable">
            <tr><th>时间</th><th>标的</th><th>动作</th><th>方向</th><th>数量</th><th>价格</th><th>金额</th><th>备注</th><th></th></tr>
            ${(trades.data || []).map(t => `<tr>
              <td>${new Date(t.datetime).toLocaleDateString()}</td>
              <td>${esc(t.symbol_name)}</td>
              <td><span class="badge blue">${actLabel(t.action)}</span></td>
              <td>${t.side === 'buy' ? '买' : '卖'}</td>
              <td>${fmt(t.quantity)}</td><td>${fmt(t.price)}</td><td>${fmtMoney(t.amount)}</td>
              <td class="muted">${esc(t.note)}</td>
              <td><button class="btn small ghost" data-del="${t.id}">删</button></td>
            </tr>`).join('') || '<tr><td colspan="9" class="muted" style="text-align:center;padding:20px">还没有交易记录，点右上角"新增交易"</td></tr>'}
          </table>
        </div>`;
      $('#addTrade').onclick = () => openTradeForm(symOpts);
      $$('[data-del]', root).forEach(b => b.onclick = async () => {
        if (await confirmDialog('确定删除该笔交易？')) { await guard(Api.delTrade(b.dataset.del)); renderTrades(root); }
      });
    } catch (e) { console.error('[trades]', e); root.innerHTML = `<div class="empty"><div class="big">⚠️</div><p>加载失败</p></div>`; }
  }
  const actLabel = (a) => ({ open: '开仓', add: '加仓', reduce: '减仓', close: '平仓', dividend: '分红', fee: '费用' }[a] || a);
  function openTradeForm(symOpts) {
    openModal('新增交易', `
      <div class="field"><label>标的</label><select id="t_sym">${symOpts || '<option value="">请先添加标的</option>'}</select></div>
      <div class="row" style="gap:12px">
        <div class="field" style="flex:1"><label>动作</label><select id="t_act">
          <option value="open">开仓</option><option value="add">加仓</option><option value="reduce">减仓</option>
          <option value="close">平仓</option><option value="dividend">分红</option><option value="fee">费用</option></select></div>
        <div class="field" style="flex:1"><label>方向</label><select id="t_side"><option value="buy">买</option><option value="sell">卖</option></select></div>
      </div>
      <div class="row" style="gap:12px">
        <div class="field" style="flex:1"><label>数量</label><input id="t_qty" type="number" step="any" inputmode="decimal" placeholder="0"/></div>
        <div class="field" style="flex:1"><label>价格</label><input id="t_price" type="number" step="any" inputmode="decimal" placeholder="0"/></div>
      </div>
      <div class="row" style="gap:12px">
        <div class="field" style="flex:1"><label>手续费</label><input id="t_fee" type="number" step="any" inputmode="decimal" value="0"/></div>
        <div class="field" style="flex:1"><label>时间</label><input id="t_dt" type="datetime-local"/></div>
      </div>
      <div class="field"><label>备注</label><input id="t_note" placeholder="可选"/></div>
      <button class="btn block" id="t_submit">保存</button>`);
    $('#t_submit').onclick = async () => {
      const body = {
        symbol_id: parseInt($('#t_sym').value), action: $('#t_act').value, side: $('#t_side').value,
        quantity: $('#t_qty').value, price: $('#t_price').value, fee: $('#t_fee').value || 0,
        datetime: $('#t_dt').value ? new Date($('#t_dt').value).getTime() : Date.now(), note: $('#t_note').value
      };
      const r = await guard(Api.addTrade(body));
      if (r.code === 0) { closeModal(); renderTrades($('#content')); }
    };
  }

  // ---------- 持仓 ----------
  async function renderPositions(root) {
    try {
      const ov = await Api.overview();
      const positions = (ov.data && ov.data.positions || []).filter(p => p.qty > 0);
      root.innerHTML = `
        <h3 class="mb">当前持仓（可维护最新市价以计算浮动盈亏）</h3>
        <div class="card">
          <table class="table">
            <tr><th>标的</th><th>品类</th><th>方向</th><th>数量</th><th>成本</th><th>现价</th><th>市值</th><th>浮动盈亏</th><th>操作</th></tr>
            ${positions.map(p => `<tr data-sid="${p.symbol_id}">
              <td>${esc(p.name)}${p.code ? '(' + esc(p.code) + ')' : ''}</td>
              <td>${labelCat(p.category)}</td>
              <td>${p.direction === 'short' ? '空' : '多'}</td>
              <td>${fmt(p.qty)}</td><td>${fmt(p.avg_cost)}</td>
              <td><input style="width:90px" type="number" step="any" inputmode="decimal" value="${p.market_price == null ? '' : p.market_price}" data-price="${p.symbol_id}" placeholder="录入市价"/></td>
              <td>${fmtMoney(p.market_value)}</td>
              <td class="${pnlClass(p.float_pnl)}">${p.float_pnl == null ? '-' : fmtMoney(p.float_pnl)}</td>
              <td><button class="btn small" data-set="${p.symbol_id}">更新</button></td>
            </tr>`).join('') || '<tr><td colspan="9" class="muted" style="text-align:center;padding:20px">暂无持仓</td></tr>'}
          </table>
        </div>`;
      $$('[data-set]', root).forEach(b => b.onclick = async () => {
        const inp = $(`[data-price="${b.dataset.set}"]`);
        if (inp.value === '') return toast('请先录入市价');
        await guard(Api.setPrice(b.dataset.set, inp.value));
        toast('已更新'); renderPositions(root);
      });
    } catch (e) { console.error('[positions]', e); root.innerHTML = `<div class="empty"><div class="big">⚠️</div><p>加载失败</p></div>`; }
  }

  // ---------- 止盈止损 ----------
  async function renderAlerts(root) {
    try {
      const [syms, rules, logs] = await Promise.all([Api.listSymbols(), Api.listRules(), Api.listLogs()]);
      const symOpts = (syms.data || []).map(s => `<option value="${s.id}">${esc(s.name)}${s.code ? '(' + esc(s.code) + ')' : ''}</option>`).join('');
      root.innerHTML = `
        <div class="spread mb"><h3>提醒规则</h3><button class="btn small" id="addRule">+ 新增规则</button></div>
        <div class="card mb">
          <table class="table" id="ruleTable">
            <tr><th>标的</th><th>类型</th><th>模式</th><th>阈值</th><th>状态</th><th></th></tr>
            ${(rules.data || []).map(r => `<tr><td>${esc(r.symbol_name)}</td>
              <td><span class="badge ${r.type === 'stop_profit' ? 'green' : 'red'}">${r.type === 'stop_profit' ? '止盈' : '止损'}</span></td>
              <td>${r.mode === 'percent' ? '涨跌幅%' : '价格'}</td><td>${r.threshold}</td>
              <td>${r.status === 'active' ? '启用' : '停用'}</td>
              <td><button class="btn small ghost" data-del="${r.id}">删</button></td></tr>`).join('')
              || '<tr><td colspan="6" class="muted" style="text-align:center;padding:16px">暂无规则</td></tr>'}
          </table>
        </div>
        <div class="spread mb"><h3>提醒中心</h3><button class="btn small" id="btnCheck">检查触发</button></div>
        <div class="card">
          <table class="table">
            <tr><th>时间</th><th>标的</th><th>内容</th><th>状态</th><th></th></tr>
            ${(logs.data || []).map(l => `<tr><td>${new Date(l.triggered_at).toLocaleString()}</td>
              <td>${esc(l.symbol_name)}</td><td>${esc(l.message)}</td>
              <td>${l.handled ? '<span class="badge">已处理</span>' : '<span class="badge red">未处理</span>'}</td>
              <td>${l.handled ? '' : '<button class="btn small" data-handle="' + l.id + '">标记已处理</button>'}</td></tr>`).join('')
              || '<tr><td colspan="5" class="muted" style="text-align:center;padding:16px">暂无提醒</td></tr>'}
          </table>
        </div>`;
      if ($('#addRule')) $('#addRule').onclick = () => {
        openModal('新增止盈止损规则', `
          <div class="field"><label>标的</label><select id="r_sym">${symOpts || '<option value="">请先添加标的</option>'}</select></div>
          <div class="row" style="gap:12px">
            <div class="field" style="flex:1"><label>类型</label><select id="r_type"><option value="stop_profit">止盈</option><option value="stop_loss">止损</option></select></div>
            <div class="field" style="flex:1"><label>模式</label><select id="r_mode"><option value="percent">涨跌幅%</option><option value="price">价格</option></select></div>
          </div>
          <div class="field"><label>阈值（如 20 表示 +20% 或价格 20）</label><input id="r_th" type="number" step="any" inputmode="decimal"/></div>
          <button class="btn block" id="r_submit">保存</button>`);
        $('#r_submit').onclick = async () => {
          const r = await guard(Api.addRule({ symbol_id: parseInt($('#r_sym').value), type: $('#r_type').value, mode: $('#r_mode').value, threshold: $('#r_th').value }));
          if (r.code === 0) { closeModal(); renderAlerts(root); }
        };
      };
      $$('[data-del]', root).forEach(b => b.onclick = async () => { if (await confirmDialog('删除该规则？')) { await guard(Api.delRule(b.dataset.del)); renderAlerts(root); } });
      $$('[data-handle]', root).forEach(b => b.onclick = async () => { await guard(Api.handleLog(b.dataset.handle)); renderAlerts(root); });
      if ($('#btnCheck')) $('#btnCheck').onclick = async () => { const r = await guard(Api.checkAlerts()); toast(r.code === 0 ? (r.data.length ? '触发 ' + r.data.length + ' 条提醒' : '未触发新提醒') : '检查失败'); renderAlerts(root); };
    } catch (e) { console.error('[alerts]', e); root.innerHTML = `<div class="empty"><div class="big">⚠️</div><p>加载失败</p></div>`; }
  }

  // ---------- 复盘 ----------
  async function renderReviews(root) {
    try {
      const [list, tpl] = await Promise.all([Api.listReviews(), Api.reviewTemplate()]);
      root.innerHTML = `
        <div class="spread mb"><h3>投资复盘</h3><button class="btn small" id="addReview">+ 新建复盘</button></div>
        <div class="grid">
          ${(list.data || []).map(r => {
            const c = r.content || {};
            return `<div class="card">
              <div class="spread mb"><span class="badge blue">${ptype(r.period_type)}</span>
                <span class="muted">${new Date(r.start_date).toLocaleDateString()} ~ ${new Date(r.end_date).toLocaleDateString()}</span></div>
              ${(tpl.data && tpl.data.fields || []).map(f => c[f.key] ? `<div class="mb"><div class="muted" style="font-size:12px">${f.label}</div><div>${esc(c[f.key])}</div></div>` : '').join('')}
              <div class="row" style="justify-content:flex-end;gap:8px;margin-top:8px">
                <button class="btn small ghost" data-del="${r.id}">删除</button></div>
            </div>`;
          }).join('') || '<div class="empty"><div class="big">📝</div>还没有复盘，点"新建复盘"开始</div>'}
        </div>`;
      const fields = (tpl.data && tpl.data.fields) || [];
      if ($('#addReview')) $('#addReview').onclick = () => {
        const fieldsHtml = fields.map((f, i) => `<div class="field"><label>${f.label}（${f.hint || ''}）</label><textarea id="rv_${f.key}" rows="2"></textarea></div>`).join('');
        openModal('新建复盘', `
          <div class="row" style="gap:12px">
            <div class="field" style="flex:1"><label>周期类型</label><select id="rv_type"><option value="week">周复盘</option><option value="month">月复盘</option><option value="custom">自定义</option></select></div>
            </div>
            <div class="row" style="gap:12px">
              <div class="field" style="flex:1"><label>开始日期</label><input id="rv_sd" type="date"/></div>
              <div class="field" style="flex:1"><label>结束日期</label><input id="rv_ed" type="date"/></div>
            </div>
            ${fieldsHtml}
            <button class="btn block" id="rv_submit">保存复盘</button>`);
        $('#rv_submit').onclick = async () => {
          const content = {}; fields.forEach(f => content[f.key] = $('#rv_' + f.key).value);
          const sd = $('#rv_sd').value || new Date().toISOString().slice(0, 10);
          const ed = $('#rv_ed').value || sd;
          const r = await guard(Api.addReview({ period_type: $('#rv_type').value, start_date: sd, end_date: ed, content }));
          if (r.code === 0) { closeModal(); renderReviews(root); }
        };
      };
      $$('[data-del]', root).forEach(b => b.onclick = async () => { if (await confirmDialog('删除该复盘？')) { await guard(Api.delReview(b.dataset.del)); renderReviews(root); } });
    } catch (e) { console.error('[reviews]', e); root.innerHTML = `<div class="empty"><div class="big">⚠️</div><p>加载失败</p></div>`; }
  }
  const ptype = (t) => ({ week: '周复盘', month: '月复盘', custom: '自定义' }[t] || t);

  // ---------- 我的 ----------
  async function renderProfile(root) {
    try {
      const pref = await Api.getPref();
      const theme = (pref.data && pref.data.theme) || 'light';
      root.innerHTML = `
        <div class="grid cols-2">
          <div class="card">
            <h3 class="mb">账号</h3>
            <p>用户名：<b>${esc(state.user.username)}</b></p>
            <div class="field mt"><label>修改密码</label>
              <input id="op" type="password" placeholder="原密码"/></div>
            <div class="row" style="gap:12px">
              <input id="np" type="password" placeholder="新密码（8位+含字母数字）"/>
              <button class="btn" id="chg">保存</button></div>
          </div>
          <div class="card">
            <h3 class="mb">主题</h3>
            <div class="theme-grid" id="profileThemes"></div>
          </div>
          <div class="card">
            <h3 class="mb">数据</h3>
            <button class="btn ghost" id="exportBtn">导出全部数据 (JSON)</button>
            <p class="muted mt">数据仅存储于本账号，可随时导出备份。</p>
            <p class="muted">声明：本工具为个人投资记录辅助，不构成任何投资建议。</p>
          </div>
        </div>`;
      renderThemeGrid($('#profileThemes'), theme);
      if ($('#chg')) $('#chg').onclick = async () => {
        const r = await guard(Api.changePwd($('#op').value, $('#np').value));
        if (r.code === 0) { toast('密码已修改'); $('#op').value = $('#np').value = ''; }
      };
      if ($('#exportBtn')) $('#exportBtn').onclick = async () => {
        const r = await Api.exportData();
        if (r.code === 0) {
          const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
          a.download = 'investment-diary-export.json'; a.click();
        } else toast('导出失败');
      };
    } catch (e) { console.error('[profile]', e); root.innerHTML = `<div class="empty"><div class="big">⚠️</div><p>加载失败</p></div>`; }
  }

  // ---------- 主题弹窗 ----------
  function renderThemeGrid(container, current) {
    container.innerHTML = Theme.THEMES.map(t => `<div class="theme-item ${t.id === current ? 'active' : ''}" data-theme="${t.id}" style="cursor:pointer;text-align:center">
      <div style="height:54px;border-radius:10px;background:${t.preview};border:1px solid var(--border)"></div>
      <div class="muted" style="font-size:12px;margin-top:4px">${t.name}</div></div>`).join('');
    $$('.theme-item', container).forEach(el => el.onclick = () => {
      Theme.set(el.dataset.theme);
      $$('.theme-item', container).forEach(x => x.classList.toggle('active', x.dataset.theme === el.dataset.theme));
    });
  }
  function setupThemeUI() {
    const grid = $('#themeGrid');
    const open = async () => { const p = await Api.getPref().catch(() => ({ data: { theme: Theme.localTheme } })); renderThemeGrid(grid, (p.data && p.data.theme) || 'light'); $('#themeModal').hidden = false; };
    $('#themeBtn').onclick = open;
    $('#themeBtn2').onclick = open;
    $('#themeClose').onclick = () => ($('#themeModal').hidden = true);
  }

  // ---------- 全局事件 ----------
  function bindGlobal() {
    $('#formClose').onclick = closeModal;
    $('#logoutBtn').onclick = async () => { await Api.logout(); state.user = null; location.hash = '#/login'; };
    // 所有 modal-mask 点击遮罩关闭（不只是第一个）
    $$('.modal-mask').forEach(mask => mask.addEventListener('click', e => {
      if (e.target === mask) mask.hidden = true;
    }));
  }

  // ---------- 启动 ----------
  async function boot() {
    try {
      await Theme.init();
      setupThemeUI();
      bindGlobal();
      window.addEventListener('hashchange', route);
      await route();
    } catch (e) {
      console.error('[boot]', e);
      document.getElementById('content').innerHTML = `<div class="empty"><div class="big">⚠️</div><p>应用初始化失败，请刷新页面</p><button class="btn mt" onclick="location.reload()">刷新</button></div>`;
    }
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
