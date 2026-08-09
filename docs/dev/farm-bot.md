---
doc_type: dev-guide
slug: farm-bot
component: farm-bot
status: current
summary: hybgzs 农场 bot 的运行结构、配置项、脚本入口、状态文件和维护注意事项。
tags: [farm, bot, cdp, chrome, maintainer]
last_reviewed: 2026-07-24
---

## 概述

hybgzs-farm-bot 是一个基于 Node.js ESM 的本地自动化脚本，使用 Chrome DevTools Protocol 直接控制专用 Chrome，而不是 Playwright。它围绕一轮农场流程组织逻辑：进入主页、进入农场、收获、卖出本轮收获的普通作物、按策略补种、读取当前农场状态，并在常驻模式下安排下一轮执行时间。

项目的目标偏稳态运行：尽量复用专用 Chrome 登录态、避免多实例、遇到页面或 CDP 连接问题时优先重试或重建标签页，同时默认拦截会产生额外花费的确认动作。

## 前置依赖

- Node.js 运行环境。
- macOS 上可用的 Google Chrome。
- 依赖安装后，当前运行时依赖只有 ws。
- 本地可写目录用于保存 chrome-profile、logs、data。

开发时最基础的检查命令是：

    node --check scripts/farm-bot.js

## 快速上手

安装依赖：

    npm install

只启动专用 Chrome：

    npm run chrome

单次执行主流程：

    npm run farm

常驻执行主流程：

    npm run farm:watch

更推荐用项目脚本启动常驻模式：

    ./start.sh

## 核心概念

### 专用 Chrome

脚本通过 scripts/chrome-launcher.js 启动单独的 Chrome，并使用 chrome-profile 作为独立 profile。这样能复用登录态，同时避免污染日常浏览器。

### CDP 页面控制

scripts/farm-bot.js 内部的 CdpPage 封装了 WebSocket 连接、CDP 命令发送、超时控制、重连和心跳保活。页面操作通过 DOM 查询与点击组合完成，不依赖外部浏览器自动化框架。

### 自动种植策略

- strategy.plantCrop 为固定作物名时，脚本始终种该作物。
- strategy.plantCrop 为 auto 时，脚本在交易所读取价格后，结合本地图鉴里的 seedPrice、yield、growHours 计算日收入。
- 自动策略只会在以下时机重算：本地无已锁定作物、无上次排行缓存，或成功种植轮数达到 strategy.recalcAfterSuccessfulPlantRounds。
- 重算周期内会锁定当前作物，不因为单轮 UI 失败而自动切换到别的候选作物。

### 本地状态

data/farm-state.json 会保存：

- 当前锁定作物 selectedCrop
- 最近推荐作物 recommendedCrop
- 自上次重算后的成功种植轮数
- 最近一次策略重算时间
- 最近读到的交易所价格
- 最近的收益排行摘要

这样常驻模式在重启后仍能延续策略，而不是每次都从零开始推断。

## 接口参考

### npm scripts

| 命令 | 作用 |
|---|---|
| npm run chrome | 只启动专用 Chrome，不跑农场流程 |
| npm run farm | 执行单次农场流程 |
| npm run farm:watch | 进入常驻模式 |

### 入口脚本

| 文件 | 作用 |
|---|---|
| scripts/start-chrome.js | 读取配置并启动专用 Chrome |
| scripts/chrome-launcher.js | 查找 Chrome 路径并拉起带远程调试端口的浏览器 |
| scripts/farm-bot.js | 主流程、页面控制、策略计算、通知、常驻调度 |
| start.sh | 常驻模式的安全启动器，负责停旧进程、清锁、启动和单实例校验 |
| setup-caffeinate.sh | 在 macOS 上部署独立防休眠服务 |

### farm-config.json

常用配置项如下：

| 路径 | 默认值 | 说明 |
|---|---:|---|
| chrome.debugPort | 9222 | 专用 Chrome 的远程调试端口 |
| chrome.chromePath | null | Chrome 可执行文件路径；为空时自动在 macOS 常见路径中查找 |
| chrome.cdpOrigin | null | 自定义 CDP 根地址；默认使用 debugPort 拼出本地地址 |
| timing.stepTimeoutMs | 45000 | 单步等待超时 |
| timing.manualTimeoutMs | 600000 | 等待人工登录或验证的最长时间 |
| timing.cdpCommandTimeoutMs | 15000 | 单条 CDP 命令超时 |
| timing.intervalMinutes | 10 | 读取不到成熟时间时的兜底轮询间隔 |
| timing.matureBufferSeconds | 120 | 页面显示成熟后额外等待的缓冲秒数 |
| timing.actionRetryMinutes | 3 | 可收获、可种植或无库存场景下的更短重试间隔 |
| timing.failureRetrySeconds | 10 | 本轮失败后的快速重试间隔 |
| timing.uiWaitAttempts | 5 | UI 就绪重试次数 |
| timing.uiWaitSeconds | 10 | UI 重试间隔秒数 |
| timing.heartbeatMinutes | 60 | 心跳相关时间配置；当前通知已收敛到每日汇总与异常告警 |
| retries.plantAttempts | 3 | 补种动作重试次数 |
| retries.sellAttempts | 2 | 卖出动作重试次数 |
| strategy.plantCrop | auto | 固定作物名或 auto |
| strategy.maxSeedPrice | 7 | 自动策略允许参与比较的普通作物最高种子价 |
| strategy.recalcAfterSuccessfulPlantRounds | 6 | 成功种植多少轮后重算一次自动策略 |

### 通知配置

通知配置支持两种来源：

1. farm-config.local.json 中的 telegram.botToken 和 telegram.chatId。
2. .env 中的 TG_BOT_TOKEN 和 TG_CHAT_ID。

代码里优先读取配置文件，再回退到环境变量。

### 支持的调试参数

scripts/farm-bot.js 除了默认单次运行和 --watch 外，还支持：

| 参数 | 作用 |
|---|---|
| --watch | 常驻模式 |
| --rank-only | 只读取交易所价格并打印收益排行，不执行农场主流程 |
| --test-sell <作物名> --quantity <数量> | 对快速卖出流程做定向诊断 |

## 常见场景

### 场景 1：修改自动策略参数

如果想限制自动模式不要选种子过贵的作物：

    {
      "strategy": {
        "plantCrop": "auto",
        "maxSeedPrice": 8,
        "recalcAfterSuccessfulPlantRounds": 6
      }
    }

这会让自动收益计算仅在普通作物里挑选 seedPrice 小于等于 8 的候选项。

### 场景 2：固定种某一种作物

    {
      "strategy": {
        "plantCrop": "南瓜",
        "maxSeedPrice": 8,
        "recalcAfterSuccessfulPlantRounds": 6
      }
    }

在固定模式下，脚本不会去交易所重算收益排行。

### 场景 3：只验证 Chrome 和登录态是否可用

    npm run chrome

适合在修改 CDP 连接、Chrome 路径或首次部署后，先验证浏览器能否正常启动并保留登录态。

### 场景 4：只看当前利润排行

    node scripts/farm-bot.js --rank-only

这个模式会新开标签页去读取交易所价格并打印排行，避免干扰已有的常驻实例。

## 已知限制与注意事项

- 项目明确不使用 Playwright；维护时不要重新引入 Playwright 依赖或 API。
- 页面动作后通常会重新进入农场页面，以获得稳定状态；不要把逻辑改成只靠固定 sleep 盲等。
- 所有购买、支付、花费、消耗类原生确认弹窗默认拒绝，避免误花钱。
- 登录、Cloudflare、安全验证仍然需要人工完成，脚本不会绕过。
- 常驻模式依赖单实例锁文件 data/farm-watch.lock；如果异常退出造成锁残留，应该先确认旧进程是否真的不存在，再清理锁。
- chrome-profile、.env、farm-config.local.json 都包含本地状态或敏感信息，不应提交。
- 当前仓库没有自动化测试套件；改动后至少要跑语法检查和一次真实流程验证。

## 相关文档

- 面向日常使用者的说明见 ../user/farm-bot.md。
- 快速入口和概览说明仍在 README.md。
- 项目注意事项见 .codestable/attention.md。
- 当前架构概览见 .codestable/architecture/ARCHITECTURE.md。
