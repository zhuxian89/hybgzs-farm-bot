---
doc_type: audit-finding
audit: 2026-06-13-farm-bot-flow
finding_id: "bug-05"
nature: bug
severity: P1
confidence: medium
suggested_action: cs-issue
status: open
---

# Finding 05：种植流程点击确认后未验证结果，且“最大”按钮选择过宽

## 速答

种植流程中“最大”和确认种植都按宽松文本选择，确认后只 sleep 2 秒就返回 true；没有验证已种植数量、空闲槽位、作物名称或剩余时间是否符合预期。

## 关键证据

- `scripts/farm-bot.js:283` — `clickEnabledButtonContaining()` 使用 `value.includes(text)` 匹配按钮文本。
- `scripts/farm-bot.js:648` — 点击“最大”时直接传入 `'最大'`，如果页面存在多个包含“最大”的可用按钮，可能选错。
- `scripts/farm-bot.js:656` — `clickPlantConfirm()` 找到第一个符合 `/^种植 x\d+$/` 的按钮就点击。
- `scripts/farm-bot.js:663` — 确认后固定 `sleep(2000)`。
- `scripts/farm-bot.js:665` — 没有验证种植结果就 `return true`。

## 影响

如果弹窗没有选中玉米、最大数量没有生效、确认按钮点击后请求失败，脚本仍把 `planted` 当作 true。单次通知会显示“种植：成功”，watch 也会按种植后的状态继续计算，用户看到的结果可能和真实农场状态不一致。

## 修复方向

限定“最大”按钮在种植弹窗/玉米区域内；确认后等待农场状态满足“空闲槽位减少、作物包含玉米、剩余时间出现、生长中增加”，不满足就重进农场重读，必要时重新种植。

## 建议动作

`cs-issue`，因为这是会造成漏种或误报成功的流程 bug。
