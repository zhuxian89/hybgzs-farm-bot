---
doc_type: issue-report
issue: 2026-06-13-farm-bot-flow-recovery
status: confirmed
severity: P0
summary: 农场常驻流程在页面或 CDP 异常时可能死等、误判收获种植结果，不能稳定从头恢复
tags: [farm-bot, cdp, recovery, telegram]
---

# 农场流程恢复 Issue Report

## 1. 问题现象

农场脚本在常驻模式中遇到页面未按预期渲染、收获后弹窗/状态未更新、CDP 连接异常等情况时，可能长时间等待、误报成功，或下一轮继续复用坏页面状态。用户要求除 Cloudflare 安全验证和 Google 密码输入外，其他异常都不能死等，必须有预期结果校验，失败后从主页/农场重新开始或重建连接。

## 2. 复现步骤

1. 运行 `npm run farm:watch`。
2. 页面进入农场后执行收获或种植，或在任一步遇到页面未渲染、按钮点击后状态没变化、CDP 连接半断。
3. 观察到：脚本可能停在等待里，或显示本轮完成但实际未收获/未种植，或下一轮继续用坏页面状态。

复现频率：依赖网页状态和 CDP 连接稳定性；用户已观察到收获后流程停住、状态判断不对、长时间等待等问题。

## 3. 期望 vs 实际

**期望行为**：每一步动作都有明确预期界面结果；没有预期结果时有限等待后重进主页/农场或重建连接；只有 Cloudflare 安全验证和 Google 密码输入进入人工等待，并发送 Telegram 通知。

**实际行为**：CDP 请求可能永久悬挂；人工等待范围过宽；watch 失败后复用同一页面；收获/种植点击后没有严格验证结果；统计解析可能误判下一轮时间。

## 4. 环境信息

- 涉及模块 / 功能：农场自动化主流程、CDP 页面控制、Telegram 通知、常驻调度
- 相关文件 / 函数：`scripts/farm-bot.js`
- 运行环境：本地 Node.js ESM，专用 Chrome + CDP，`npm run farm` / `npm run farm:watch`
- 其他上下文：详见 `.codestable/audits/2026-06-13-farm-bot-flow/`

## 5. 严重程度

**P0** — 常驻脚本一旦卡住会完全停止自动收获/种植，并且用户无法从日志看出是否需要手动处理。

## 备注

本 issue 承接审计报告 `.codestable/audits/2026-06-13-farm-bot-flow/index.md` 中 Finding 01-06。
