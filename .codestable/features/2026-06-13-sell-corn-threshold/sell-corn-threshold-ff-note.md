---
doc_type: feature-ff-note
feature: sell-corn-threshold
date: 2026-06-13
requirement:
tags: [farm-bot, corn, recycle, telegram]
---

## 做了什么
新增玉米库存阈值卖出能力：每轮农场流程结束前进入交易所检查玉米持有数量，达到默认阈值 500 时卖出全部玉米。

## 改了哪些
- `scripts/farm-bot.js` — 增加交易所页面进入、玉米持有读取、快速卖出弹窗内只选择玉米并确认卖出的流程。
- `README.md` — 补充玉米自动卖出规则；该旧阈值能力后续已被自动作物策略替代，普通运行配置统一迁移到 `farm-config.json`。
- `.codestable/attention.md` — 记录只卖玉米和默认阈值约束。

## 怎么验证的
已用 CDP 读取交易所页面和快速卖出弹窗结构；当前玉米持有为 0，`npm run farm` 验证低于阈值时只检查交易所并跳过卖出。
