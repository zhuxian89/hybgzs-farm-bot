# hybgzs-farm-bot 架构总入口

> 状态：骨架（待填充）
> 创建日期：2026-06-13

## 1. 项目简介

`hybgzs-farm-bot` 是一个本地 Node.js 自动化脚本，用 Chrome DevTools Protocol 操作专用 Chrome profile，执行福利站农场的收获、自动选作物补种、收获后卖出并保留种子的流程，并通过 Telegram 发送关键状态通知。

## 2. 核心概念 / 术语表

- 专用 Chrome：由 `scripts/start-chrome.js` / `scripts/chrome-launcher.js` 启动的独立 Chrome profile。
- CDP：Chrome DevTools Protocol，`scripts/farm-bot.js` 通过 WebSocket 连接页面并执行 DOM 操作。
- 农场一轮：进入主页、进入农场、收获、卖出本轮收获作物并保留种子、补种、读取状态、计算下一次运行时间。

## 3. 子系统 / 模块索引

- `scripts/chrome-launcher.js`：定位并启动专用 Chrome。
- `scripts/start-chrome.js`：只启动专用 Chrome 的入口。
- `scripts/farm-bot.js`：农场主流程、CDP 页面控制、状态读取、Telegram 通知。
- `farm-config.json`：本地普通运行配置，包含 Chrome 端口、Chrome 程序路径、等待节奏、重试次数和作物策略。
- `.env`：Telegram 凭证（不提交）。
- `chrome-profile/`：专用 Chrome 登录态与本地缓存（不提交）。
- `data/farm-crops.json`：本地图鉴数据，记录作物成本、成熟时间和产量。
- `data/farm-state.json`：本地运行状态，记录当前推荐作物、已成功种植轮数和上次收益排名。

## 4. 关键架构决定

- 不使用 Playwright，直接使用 Chrome DevTools Protocol 与 `ws`。
- 使用专用 Chrome profile 保持登录态，避免污染日常 Chrome。
- 动作后优先重新进入农场页面以获取稳定状态。
- 常驻模式优先按页面剩余成熟时间智能等待，解析失败才使用固定间隔。

## 5. 已知约束 / 硬边界

- 不绕过 Cloudflare；需要验证或登录时等待用户手工完成。
- 默认按图鉴成本和交易所现价计算每小时利润，每成功种植 6 轮后重算一次；没有候选作物库存时继续后续检查。
- 不自动购买菜场作物；任何购买/支付/花费类确认默认拒绝。
- Telegram token 等敏感配置只能在 `.env` 中保存。
