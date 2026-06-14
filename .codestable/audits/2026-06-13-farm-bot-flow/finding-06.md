---
doc_type: audit-finding
audit: 2026-06-13-farm-bot-flow
finding_id: "bug-06"
nature: bug
severity: P1
confidence: medium
suggested_action: cs-issue
status: open
---

# Finding 06：农场统计解析过于宽松，可能误判状态并算错下一轮时间

## 速答

`readFarmSummary()` 从 `body *` 全局扫描文本，再向上找最多 6 层祖先，取最短候选文本里的数字；页面结构稍变、卡片嵌套文本变多或存在重复标签时，可能把错误数字当成“可收获/空闲槽位/生长中”。

## 关键证据

- `scripts/farm-bot.js:473` — 扫描 `document.querySelectorAll('body *')`，范围是整个页面。
- `scripts/farm-bot.js:481` — 对 label 节点向上查 6 层祖先，容易把多个卡片或整块区域文本纳入候选。
- `scripts/farm-bot.js:497` — 只按文本长度排序取最短候选，没有校验候选是否来自统计卡片。
- `scripts/farm-bot.js:509` — `summaryReady()` 只要求 4 个标签中至少 3 个是数字，允许缺一个关键字段仍继续。
- `scripts/farm-bot.js:704` — `getNextDelayMs()` 直接根据 `harvestable`、`emptySlots` 和 `nextRemaining` 决定下一轮等待。

## 影响

如果 `空闲槽位` 被误读为 0，脚本会跳过种植；如果 `可收获` 被误读为 0，会跳过收获；如果 `剩余` 或统计状态误读，watch 会睡错时间。这个问题和用户之前看到“页面有总结但脚本状态不对”的现象高度相关。

## 修复方向

优先读取农场统计卡片的稳定 DOM 容器，按 label 邻近的 value 节点解析；解析不到时不要猜，重进农场再读。用于调度的状态应要求关键字段完整，并在不完整时走短间隔恢复检查。

## 建议动作

`cs-issue`，因为状态解析直接决定收获、种植和下一轮时间。
