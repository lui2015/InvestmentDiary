// theme.js - 主题管理
const Theme = {
  THEMES: [
    { id: 'light', name: '默认（浅色）', preview: 'linear-gradient(135deg,#fff,#eef)' },
    { id: 'dark', name: '暗色', preview: 'linear-gradient(135deg,#1a1d27,#0f1117)' },
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
    const colors = { light: '#4f46e5', dark: '#0f1117', cyberpunk: '#ff2bd6', comic: '#ff6b35' };
    if (meta) meta.setAttribute('content', colors[resolved] || '#4f46e5');
  },
  async init() {
    let theme = localStorage.getItem('theme');
    if (!theme) {
      const r = await Api.getPref().catch(() => ({ data: { theme: 'light' } }));
      theme = (r && r.data && r.data.theme) || 'light';
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
