---
doc_type: audit-finding
audit: 2026-06-13-farm-bot-flow
finding_id: "bug-03"
nature: bug
severity: P1
confidence: high
suggested_action: cs-issue
status: open
---

# Finding 03：常驻模式本轮失败后不重建页面连接，下一轮继续使用坏状态

## 速答

watch 模式只在启动时创建一次 `page`；本轮失败后只是发通知并按 fallback 间隔等待，下一轮仍然复用同一个页面和 CDP 连接，没有执行“从主页重新来”或“重建连接”。

## 关键证据

- `scripts/farm-bot.js:731` — `const page = await getOrCreatePage();` 在进入 watch 循环前只创建一次。
- `scripts/farm-bot.js:736` — `while (true)` 内每轮都调用同一个 `runFarmOnce(page)`。
- `scripts/farm-bot.js:740` — catch 到本轮错误后只打印和 TG 通知，没有 `reenterFarmPage()`、`page.close()`、`getOrCreatePage()` 或重新打开主页。
- `scripts/farm-bot.js:745` — 失败时 `result` 为 `null`，`getNextDelayMs(result?.status)` 走 fallback。
- `scripts/farm-bot.js:714` — fallback 是 `intervalMs`，默认 10 分钟。

## 影响

如果页面已经处在坏状态，例如弹窗未处理、路由半跳转、前端渲染失败、CDP 连接异常、按钮点击后状态不同步，下一轮仍从同一个坏页面继续，恢复概率低。用户明确说“每次从农场从头来肯定可以解决”，当前失败恢复没有做到这一点。

## 修复方向

watch 每轮失败后应按错误类型执行恢复：CDP 级错误重建连接；页面状态错误从 HOME_URL 重新开始；农场动作后状态不符则重进 FARM_URL 并有限重试。失败后的下一轮间隔也应使用短恢复间隔，而不是成熟时间 fallback。

## 建议动作

`cs-issue`，因为这是常驻流程的核心恢复策略缺陷。
