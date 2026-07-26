---
doc_type: user-guide
slug: farm-bot
component: farm-bot
status: current
summary: hybgzs 农场 bot 的安装、登录、启动、日常运行和异常处理指南。
tags: [farm, bot, chrome, telegram]
last_reviewed: 2026-07-26
---

## 功能简介

hybgzs-farm-bot 会自动执行福利站农场的一轮完整流程：进入农场、收获成熟作物、卖出本轮收获的普通作物并保留下一轮种子、按配置补种，然后根据页面状态决定下一次检查时间。

推荐把它当成长期值守脚本来使用。首次登录完成后，后续会复用专用 Chrome 的登录态。

## 前置条件

- macOS 环境，已安装 Google Chrome。
- 本机可以运行 Node.js，并且已经在项目目录执行过 npm install。
- 首次使用时，需要你亲自完成 Cloudflare、安全验证、LinuxDo 或 Google 登录与授权。
- 如果你想接收 Telegram 通知，需要准备 bot token 和 chat id。

## 如何使用

### 安装依赖

在项目根目录执行：

    npm install

### 准备基础配置

普通运行配置写在项目根目录的 farm-config.json。最常用的是这几项：

    {
      "chrome": {
        "debugPort": 9222,
        "chromePath": null
      },
      "timing": {
        "intervalMinutes": 10,
        "matureBufferSeconds": 120,
        "actionRetryMinutes": 3
      },
      "strategy": {
        "plantCrop": "auto",
        "maxSeedPrice": 7,
        "recalcAfterSuccessfulPlantRounds": 6
      }
    }

- plantCrop 写 auto 时，脚本会自动按收益选择普通作物。
- maxSeedPrice 会限制自动策略允许参与比较的作物。
- recalcAfterSuccessfulPlantRounds 表示成功种植多少轮后重新计算一次收益排行。

如果 Chrome 不在默认安装位置，需要把 chrome.chromePath 改成你本机的实际可执行文件路径。

### 首次登录专用 Chrome

先只启动专用 Chrome：

    npm run chrome

脚本会启动一个单独的 Chrome profile，目录是 chrome-profile。请在这个 Chrome 里完成：

1. Cloudflare 或安全验证。
2. 福利站登录。
3. LinuxDo 或 Google 授权。

完成后不要关闭这个 Chrome，登录态会保留在 chrome-profile 中，后续运行会继续复用。

此处需截图：首次登录成功后的专用 Chrome 页面。

### 单次运行一轮农场流程

如果你只想马上执行一轮：

    npm run farm

单次运行会尝试完成以下动作：

1. 进入主页并进入农场。
2. 如果存在可收获作物，优先收获。
3. 收获后卖出本轮收获的普通作物。
4. 每块地保留 1 个种子，不会把下一轮种子卖光。
5. 如果有空闲地，则按当前策略补种。

### 部署防休眠服务

如果你要长期挂着运行，建议先部署一次独立防休眠服务：

    ./setup-caffeinate.sh

这个服务由 macOS 的 launchd 托管，作用是让电脑不进入休眠。它和 farm-bot 是解耦的，所以 bot 重启、崩溃或停止时，不会把防休眠一起停掉。

### 部署 launchd 看护服务（推荐，生产用）

常驻 bot 由 macOS launchd 服务 `com.hybgzs.farm-bot` 托管：崩溃自动重启（`KeepAlive`）、登录后自动启动（`RunAtLoad`）。首次部署一次即可：

    ./setup-farm-bot.sh

部署后 bot 立即在 launchd 下运行，并在 Mac 重启/重登后自动恢复。崩溃会被 launchd 在数秒内自动重拉，无需人工干预。

> ⚠️ `setup-farm-bot.sh` 会把当前 node 的绝对路径烘焙进 plist。node 升级或项目搬家后须重跑一次 `./setup-farm-bot.sh`。

### 重启 bot

部署完成后，重启 bot 用：

    ./start.sh

它会在 launchd 下重启 bot（等同 `launchctl kickstart -k`），不再用 nohup 后台运行。

此处需截图：start.sh 成功重启后的终端输出。

### 查看运行状态

检查进程：

    ps aux | grep farm-bot | grep -v grep

查看主日志：

    tail -f logs/farm-watch.log

查看错误日志：

    tail -f logs/farm-watch.err.log

常驻模式下，脚本会优先读取页面里的剩余时间来安排下一轮。如果页面已经显示现在可收获，或者存在空闲槽位，则会更快重试，而不是只按固定间隔死等。

### 配置 Telegram 通知

推荐把通知配置写在 farm-config.local.json，避免把敏感信息放进仓库：

    {
      "telegram": {
        "botToken": "你的 bot token",
        "chatId": "你的 chat id"
      }
    }

如果你更习惯环境变量，也可以在 .env 里写：

    TG_BOT_TOKEN=你的 bot token
    TG_CHAT_ID=你的 chat id

通知策略默认是：

- 每天 09:00 发送一次汇总。
- 需要人工登录、Cloudflare 验证、连续失败、拒绝花费类弹窗等异常时即时告警。
- 常规每轮完成和心跳不再频繁推送。

## 常见问题

Q: 为什么第一次运行时脚本像是停住了？

A: 通常不是卡死，而是在等待你手动完成 Cloudflare、安全验证、登录或授权。首次完成后，登录态会保存在 chrome-profile 中。

Q: 为什么用 start.sh / launchd 托管，而不自己 nohup 启动？

A: 因为这个项目有锁文件和单实例约束。launchd 托管（`com.hybgzs.farm-bot`）能在崩溃后自动重启、登录后自动启动；自己 nohup 起的进程崩溃就没了，也不会开机自启。`./start.sh` 只是 launchd 重启的便捷入口。

Q: 自动补种为什么没有换成别的作物？

A: 默认策略不是每一轮都重算。成功种植达到 strategy.recalcAfterSuccessfulPlantRounds 之前，会继续锁定当前作物，避免因为页面偶发问题频繁切换。

Q: 为什么卖出后还会保留一些作物？

A: 脚本会按地块数保留种子，每块地保留 1 个，用于下一轮补种，不会把本轮作物全部卖空。

Q: 为什么没有自动购买种子或处理花费弹窗？

A: 这是项目的安全边界。脚本默认拒绝购买、支付、消耗类确认弹窗，不会自动买种或做额外花费。

Q: Mac 睡眠后 bot 好像不工作了怎么办？

A: 先执行一次 setup-caffeinate.sh 部署独立防休眠服务，再用 start.sh 启动 bot。

## 相关功能

- 维护和开发方式见 ../dev/farm-bot.md。
- 默认配置入口见项目根目录的 farm-config.json。
- 快速入口和概览说明仍保留在 README.md。
