---
doc_type: audit-finding
audit: 2026-06-13-farm-bot-flow
finding_id: "bug-04"
nature: bug
severity: P1
confidence: medium
suggested_action: cs-issue
status: open
---

# Finding 04：一键收获点击后立即宣告成功，未验证预期结果

## 速答

`harvestIfPossible()` 点击“一键收获”后立即发送“成功”通知并返回 true，但没有验证 alert 内容、统计卡片变化、可收获归零或空闲槽位增加；如果点击无效或后端失败，后续种植流程会建立在错误前提上。

## 关键证据

- `scripts/farm-bot.js:417` — `harvestIfPossible()` 在页面里寻找包含“一键收获”的按钮。
- `scripts/farm-bot.js:426` — 找到可用按钮后直接 `button.click()`。
- `scripts/farm-bot.js:440` — 点击后日志写“可点击，先收获”。
- `scripts/farm-bot.js:442` — 立即 `await notify('一键收获成功。')`，此时还没有读取任何收获后的页面状态。
- `scripts/farm-bot.js:672` — `runFarmOnce()` 只要 `harvested` 为 true 就继续走收获后刷新和种植逻辑。

## 影响

Telegram 可能误报“收获成功”。更重要的是，如果收获后页面没有变成“有空闲槽位/种植按钮”的预期状态，当前代码会在 `waitForPlantableAfterHarvest()` 超时后抛错，本轮直接失败，watch 再等默认 10 分钟，而不是马上重新进入农场确认状态并补种。

## 修复方向

把收获动作改成“点击 -> 捕获 alert 文案或等待统计卡片变更 -> 验证可收获减少/空闲槽位增加 -> 再通知成功”。验证失败时重进农场并有限重试，仍失败才发异常通知。

## 建议动作

`cs-issue`，因为这是动作结果验证缺失，会导致误报和漏种。
