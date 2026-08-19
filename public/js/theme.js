// theme.js - 主题管理
const Theme = {
  THEMES: [
    { id: 'dark', name: '科技深蓝（默认）', preview: 'linear-gradient(135deg,#38bdf8,#818cf8)' },
    { id: 'light', name: '浅色经典', preview: 'linear-gradient(135deg,#fff,#eef)' },
    { id: 'cyberpunk', name: '赛博朋克', preview: 'linear-gradient(135deg,#ff2bd6,#00f0ff)' },
    { id: 'comic', name: '漫画风格', preview: 'linear-gradient(135deg,#ff6b35,#ffe600)' },
    { id: 'auto', name: '跟随系统', preview: 'linear-gradient(135deg,#ccc,#333)' },
  ],
  resolve(theme) {
    if (theme === 'auto') {
      const dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      return dark ? 'dark' : 'light';
    }
    return theme || 'light';
  },
  apply(theme) {
    const resolved = this.resolve(theme);
    document.documentElement.setAttribute('data-theme', resolved);
    // 同步移动端主题色
    const meta = document.querySelector('meta[name="theme-color"]');
    const colors = { light: '#eef2f9', dark: '#05080f', cyberpunk: '#0a0612', comic: '#fff7e6' };
    if (meta) meta.setAttribute('content', colors[resolved] || '#4f46e5');
  },
  async init() {
    let theme = localStorage.getItem('theme');
    if (!theme) {
      const r = await Api.getPref().catch(() => ({ data: { theme: 'dark' } }));
      theme = (r && r.data && r.data.theme) || 'dark';
    }
    this.persist = true;
    this.apply(theme);
    this.localTheme = theme;
  },
  set(theme) {
    localStorage.setItem('theme', theme);
    this.localTheme = theme;
    this.apply(theme);
    Api.setTheme(theme).catch(() => {});
  }
};
