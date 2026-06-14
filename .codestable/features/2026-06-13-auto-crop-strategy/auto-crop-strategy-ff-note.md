---
doc_type: feature-ff-note
feature: auto-crop-strategy
date: 2026-06-13
requirement:
tags: [farm-bot, strategy, recycle]
---

## 做了什么
新增自动作物策略：默认按本地图鉴成本、交易所现价、产量和成熟时间计算每小时利润，并每成功种植 6 轮后重算一次。
收获后会卖出本轮收获作物，但每种保留 6 个作为下次种子；不自动购买菜场作物。

## 改了哪些
- `scripts/farm-bot.js` — 增加 `data/farm-state.json` 状态读写、交易所现价读取、收益排名、候选作物补种、按作物保留种子的快速卖出流程。
- `data/farm-crops.json` — 保存图鉴作物成本、成熟时间和产量。
- `README.md` / `.codestable/attention.md` / `.codestable/architecture/ARCHITECTURE.md` — 更新运行规则、配置项和项目约束。
- `.gitignore` — 忽略本机运行状态 `data/farm-state.json`。

## 怎么验证的
已运行 `node --check scripts/farm-bot.js`。
已运行 `npm run farm` 单次流程，脚本成功读取交易所行情并选择南瓜，生成本地状态；当前无空闲槽位，因此未触发种植或卖出。

## 顺手发现
- 旧的 `sell-corn-threshold` ff-note 仍记录历史玉米阈值功能；这是历史记录，不再代表当前行为。
