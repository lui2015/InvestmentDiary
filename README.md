# 投资日记 (Investment Diary)

记录股票 / 基金 / 期货投资行为、统计盈亏收益、止盈止损提醒、投资复盘的个人工具。支持账号体系与多套主题（默认/暗色/赛博朋克/漫画风格），桌面与手机端自适应。

## 功能
- **账号体系**：注册 / 登录 / 登出 / 改密，密码 bcrypt 哈希，会话 Cookie，数据按账号隔离。
- **投资记录**：账户、标的（股票/基金/期货差异化字段）、交易流水录入、持仓与浮动盈亏计算。
- **盈亏统计**：总投入 / 市值 / 浮动 / 已实现 / 收益率，品类分布饼图、按月盈亏走势图、盈亏排行。
- **止盈止损提醒**：按涨跌幅或价格配置规则，手动/定时检查触发，站内提醒中心。
- **投资复盘**：结构化模板（操作/逻辑/结果/情绪/经验），按周/月/自定义周期管理。
- **主题切换**：默认、暗色、赛博朋克、漫画风格、跟随系统，登录后持久化。
- **多端适配**：移动优先响应式，桌面侧边栏 + 手机底部导航，同一套代码。

## 运行
```bash
npm install
cp .env .env.local   # 可选：修改 PORT / SESSION_SECRET
npm start
# 打开 http://localhost:3260
```
> 数据存储在 `./data/investment.db`（SQLite，WAL 模式）。子路径部署见 `.env` 的 `BASE_PATH`。

## 技术栈
- 后端：Node.js + Express + better-sqlite3
- 前端：原生 HTML/CSS/JS 单页应用，主题基于 CSS 变量（Design Token）

## 目录
```
server.js              入口，路由与静态资源
src/db.js              SQLite 表结构
src/auth.js            会话/鉴权/密码哈希
src/portfolio.js       持仓与盈亏计算
src/routes/            auth / records / stats / alerts / reviews / pref 接口
public/                前端（index.html, css/, js/）
```
