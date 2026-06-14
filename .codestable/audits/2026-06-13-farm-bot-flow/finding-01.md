---
doc_type: audit-finding
audit: 2026-06-13-farm-bot-flow
finding_id: "bug-01"
nature: bug
severity: P0
confidence: high
suggested_action: cs-issue
status: open
---

# Finding 01：CDP 请求没有关闭/超时兜底，WebSocket 异常时可能无限卡住

## 速答

`CdpPage.send()` 发出的 CDP 请求没有 per-command timeout，也没有在 WebSocket `close/error` 时 reject pending 请求；一旦 Chrome、页面或 CDP 连接进入半断状态，`await page.evaluate()` / `await page.goto()` 可能永远不返回，常驻流程就会死等。

## 关键证据

- `scripts/farm-bot.js:143` — `connect()` 只处理 `message`，只在连接建立前监听一次 `error`，没有持续监听 `close/error` 来清理 `this.pending`。
- `scripts/farm-bot.js:176` — `send()` 只在 `ws.send` 回调报错时 reject；消息发出后如果浏览器不再响应，`this.pending` 中的 Promise 没有任何超时出口。
- `scripts/farm-bot.js:189` — `evaluate()` 直接 `await this.send('Runtime.evaluate', ...)`，因此任何 DOM 检查、状态读取、按钮点击都可能被一个悬挂 CDP 请求卡住。
- `scripts/farm-bot.js:201` — `goto()` 也直接等待 `Page.navigate`，连接半断时会卡在进入主页/农场前。

## 影响

这是最高优先级问题。用户要求“没有预期结果不能死等”，但这里不是普通等待超时，而是 Promise 永远不 settle；`waitUntil()` 的超时也救不了，因为 predicate 内部如果卡在 `page.evaluate()`，循环无法继续计时。

## 修复方向

给 `CdpPage.send()` 增加 command timeout；给 WebSocket 注册持续 `close` / `error` 处理，统一 reject pending；watch 模式捕获这类错误后重建 CDP page，并从主页重新开始。

## 建议动作

`cs-issue`，因为这是明确的运行时卡死 bug，需要先修再谈流程细节。
