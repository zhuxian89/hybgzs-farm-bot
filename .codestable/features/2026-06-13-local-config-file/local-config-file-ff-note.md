---
doc_type: feature-ff-note
feature: local-config-file
date: 2026-06-13
requirement:
tags: [farm-bot, config, chrome, codestable]
---

## 做了什么
把农场脚本的普通运行参数统一迁移到项目根目录 `farm-config.json`，启动时不再要求用户临时传环境变量。

## 改了哪些
- `farm-config.json` / `scripts/farm-config.js` — 新增本地配置文件和默认值合并加载逻辑，`.env` 只继续承载 Telegram 凭证。
- `scripts/farm-bot.js` / `scripts/start-chrome.js` / `scripts/chrome-launcher.js` — 从本地配置读取 Chrome、等待、重试和作物策略参数，Chrome 程序路径也改为 `chrome.chromePath`。
- `README.md` / `.codestable/attention.md` / `.codestable/architecture/ARCHITECTURE.md` — 记录普通配置只改 `farm-config.json`，不要用临时环境变量启动脚本。

## 怎么验证的
已运行 `node --check scripts/farm-config.js && node --check scripts/chrome-launcher.js && node --check scripts/start-chrome.js && node --check scripts/farm-bot.js`；并用 Node 直接加载 `farm-config.json` 验证配置可读。

## 顺手发现
- 项目目录当前不是 git 仓库，无法用 `git status`/commit 跟踪本次改动。
