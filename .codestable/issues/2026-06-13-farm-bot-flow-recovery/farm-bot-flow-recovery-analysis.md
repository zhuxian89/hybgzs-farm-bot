---
doc_type: issue-analysis
issue: 2026-06-13-farm-bot-flow-recovery
status: confirmed
root_cause_type: concurrency
related: [farm-bot-flow-recovery-report.md, ../../audits/2026-06-13-farm-bot-flow/index.md]
tags: [farm-bot, cdp, recovery, telegram]
---

# 农场流程恢复根因分析

## 1. 问题定位

| 关键位置 | 说明 |
|---|---|
| `scripts/farm-bot.js:176` | `CdpPage.send()` 没有 command timeout；WebSocket 关闭或 Chrome 无响应时 pending Promise 可能永久悬挂。 |
| `scripts/farm-bot.js:311` | `waitForManualLogin()` 使用全局 10 分钟等待，且人工等待状态分类过宽。 |
| `scripts/farm-bot.js:399` | 只要没进入 dashboard/farm，就统一通知“Cloudflare 安全验证、手工登录或授权”，没有区分可恢复异常和必须人工处理场景。 |
| `scripts/farm-bot.js:417` | `harvestIfPossible()` 点击“一键收获”后立即通知成功，没有校验收获后的统计结果。 |
| `scripts/farm-bot.js:626` | `plantCornIfPossible()` 点击确认种植后只 sleep，不验证玉米是否真的进入生长状态。 |
| `scripts/farm-bot.js:731` | watch 模式只创建一次 `page`，本轮失败后下一轮继续复用同一个页面/CDP 连接。 |

## 2. 失败路径还原

**正常路径**：脚本打开主页 → 已登录后进入农场 → 等统计卡片渲染 → 如可收获则点击一键收获并确认状态 → 如有空闲槽位则选择玉米、最大数量、确认种植并确认状态 → 读取剩余时间 → 智能等待下一轮。

**失败路径**：页面或 CDP 在任一步没有返回预期结果 → `send()` 或 `waitUntil()` 长时间等待，或按钮点击后直接当成功 → watch catch 后等待 fallback 间隔，但仍复用坏页面 → 下一轮继续从坏状态运行。

**分叉点**：`scripts/farm-bot.js:176` 和 `scripts/farm-bot.js:731` — 通信层没有强制超时，调度层没有按失败类型重建页面/重进主页。

## 3. 根因

**根因类型**：并发 / 竞态 + 缺少防御

**根因描述**：脚本把“点击命令已发出”和“页面业务结果已发生”混在一起，同时缺少 CDP 命令级超时与连接断开清理。页面状态不稳定时，等待循环可能卡在一次 `evaluate()`，动作成功也可能只是按钮点击成功而不是农场状态成功。watch 调度又复用同一页面对象，使坏状态跨轮延续。

**是否有多个根因**：是。主因是 CDP Promise 无超时和失败后不重建页面；次因是人工等待分类过宽、收获/种植缺少结果验证、统计解析过松。

## 4. 影响面

- **影响范围**：影响 `npm run farm` 单次流程和 `npm run farm:watch` 常驻流程。
- **潜在受害模块**：CDP 页面控制、登录/安全验证处理、收获、种植、状态读取、下一轮调度、Telegram 通知。
- **数据完整性风险**：不会破坏本地数据，但会导致漏收、漏种、错误通知和错误等待时间。
- **严重程度复核**：维持 P0，因为常驻自动化核心目标是无人值守，死等会让核心功能完全失效。

## 5. 修复方案

### 方案 A：最小集中修复

- **做什么**：只修改 `scripts/farm-bot.js`。为 CDP 命令加超时/断线清理；增加页面状态分类；收获/种植后验证结果；失败后重进农场或重建 page；watch 失败使用短间隔并下一轮从主页开始。
- **优点**：改动集中，最快解决用户遇到的卡死和误判问题，不引入新依赖，不重构工程结构。
- **缺点 / 风险**：主文件会更长，长期维护性仍一般。
- **影响面**：仅影响农场自动化运行流程。

### 方案 B：先拆模块再修复

- **做什么**：拆出 CDP client、farm state、actions、scheduler，再分别修复。
- **优点**：长期结构更清晰。
- **缺点 / 风险**：改动大，容易在修 bug 时引入行为漂移；验证成本更高。
- **影响面**：影响脚本组织结构和所有导入路径。

### 推荐方案

**推荐方案 A**，理由：当前首要目标是阻止死等和漏收漏种；最小集中修复能直接覆盖审计 Finding 01-06，符合“不重新引入 Playwright、不顺手重构”的项目约束。
