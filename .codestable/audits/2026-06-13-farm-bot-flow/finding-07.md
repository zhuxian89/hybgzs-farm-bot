---
doc_type: audit-finding
audit: 2026-06-13-farm-bot-flow
finding_id: "maintainability-07"
nature: maintainability
severity: P2
confidence: high
suggested_action: cs-refactor
status: open
---

# Finding 07：主脚本职责过多，隐式流程状态使恢复策略难以保证一致

## 速答

`scripts/farm-bot.js` 同时承担环境变量、Telegram、CDP 客户端、DOM helper、页面状态识别、农场动作、状态解析、调度循环，导致“每一步有预期结果，不符合就恢复”的规则没有统一入口。

## 关键证据

- `scripts/farm-bot.js:48` — Telegram 通知逻辑在主脚本内。
- `scripts/farm-bot.js:136` — CDP WebSocket 客户端也在同一文件内。
- `scripts/farm-bot.js:246` — DOM 点击 helper 混在流程脚本内。
- `scripts/farm-bot.js:383` — 页面进入和登录等待逻辑在同一文件内。
- `scripts/farm-bot.js:668` — 农场一轮业务流程也在同一文件内。
- `scripts/farm-bot.js:729` — 常驻调度循环继续放在同一文件内。

## 影响

这不是单个运行时 bug，但它会放大流程 bug：每个动作各自处理 sleep、等待、通知和异常，缺少统一的“动作预期结果”和“失败恢复策略”。后续继续补丁式修改时，很容易修了收获漏了种植，修了页面等待漏了 CDP 断线。

## 修复方向

拆成最少 5 层：`cdp-client`、`page-state`、`farm-actions`、`farm-flow`、`notifier/scheduler`。把“动作 -> 验证 -> 恢复”的模式沉到 `farm-flow`，各动作只声明预期结果和重试策略。

## 建议动作

`cs-refactor`，因为这是行为保持型结构优化，建议在 P0/P1 bug 修完后做。
