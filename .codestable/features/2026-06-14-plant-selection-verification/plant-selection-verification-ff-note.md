---
doc_type: feature-ff-note
feature: plant-selection-verification
date: 2026-06-14
requirement:
tags: [farm-bot, planting, cdp, reliability]
---

## 做了什么
修复种植时误把作物列表卡片当作“已选中”的问题，改成每个动作后必须看到对应 UI 结果才进入下一步；并锁定 6 轮内的当前目标作物，不允许 UI 失败时自动降级改种。

## 改了哪些
- `scripts/farm-bot.js` — 作物选择只点单个作物卡片，不再点包含所有作物的大容器；去掉库存前置条件，允许无库存时走种植购买差额确认；选中后必须等到种植数量/确认区域出现才点最大和确认。
- `scripts/farm-bot.js` — `最大` 支持非 button 元素；点击最大后必须等到 `种植 xN` 确认按钮出现。
- `scripts/farm-bot.js` — 自动策略非重算期只返回锁定作物；只有达到 6 轮重算并重新计算收益后才允许切换。

## 怎么验证的
已运行 `node --check scripts/farm-bot.js`；单次 `npm run farm` 验证成功：前几个未真正选中的候选被跳过，最终选中蓝莓、点击最大并确认 `种植 x6`，本轮完成。
