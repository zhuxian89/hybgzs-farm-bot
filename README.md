# hybgzs farm bot

自动执行福利站农场的“收获 + 自动选作物补种 + 收获后卖出并保留种子”流程。

## 安装

```bash
npm install
```

## 运行

### 单次运行

```bash
npm run farm
```

如果专用 Chrome 没开，脚本会自动打开。首次使用时，在打开的 Chrome 里手动完成 Cloudflare、安全验证、LinuxDo/Google 登录和授权；脚本会等待并继续。

### 常驻模式（推荐）

**⚠️ 重要：使用启动脚本，避免启动多个实例！**

**首次使用前，先部署防休眠服务（一次性）**：

```bash
./setup-caffeinate.sh   # 部署独立防休眠（launchd 托管，开机自启 + 崩溃重启）
```

**然后启动 bot**：

```bash
./start.sh   # 自动停止旧进程、清理锁文件、启动新进程、验证实例数、检查防休眠
```

**启动脚本会自动：**
1. 停止现有 farm-bot 进程
2. 清理锁文件
3. 启动新进程
4. 验证只有1个实例运行
5. 检查防休眠服务是否在运行（未运行会提示）

**手动启动（不推荐，容易启动多个）**：

```bash
# 如果必须手动启动，请严格按顺序执行：
pkill -f "farm-bot.js"
sleep 2
rm -f data/farm-watch.lock
nohup node scripts/farm-bot.js --watch > logs/farm-watch.log 2> logs/farm-watch.err.log &
```

**检查运行状态**：

```bash
# 查看运行中的进程
ps aux | grep farm-bot | grep -v grep

# 查看日志
tail -f logs/farm-watch.log
```

**防止多实例机制**：
- 脚本内置锁文件保护（`data/farm-watch.lock`）
- 启动脚本自动验证只有1个实例
- 如果已有实例运行，新的启动会自动失败并提示

常驻模式会优先读取页面里的 `剩余` 时间，等到成熟后再加 120 秒缓冲执行下一轮。读取不到剩余时间时，才使用固定间隔。

如果页面显示 `现在可收获` 或存在空闲槽位，本轮会立刻尝试收获/种植；下一轮默认 3 分钟后再检查，给页面操作留缓冲。

### 防休眠服务（重要）

防休眠由独立的 `caffeinate -dimsu` 进程负责，通过 macOS **launchd** 托管，与 farm-bot **完全解耦**：

- **部署**：`./setup-caffeinate.sh`（仅需一次，写入 `~/Library/LaunchAgents/com.hybgzs.caffeinate.plist`）
- **特性**：开机自启 + 进程崩溃自动重启 + farm-bot 停止/重启/崩溃都不影响它
- **作用**：保证 Mac 永不休眠，远程始终可达
- **卸载**：`launchctl unload ~/Library/LaunchAgents/com.hybgzs.caffeinate.plist`

> 为什么独立？早期 `caffeinate` 包裹在 farm-bot 启动命令里，farm-bot 一停它也跟着死，Mac 休眠后远程就断。解耦后彻底解决。

### 常驻模式的定时检测与每日汇总（与主循环并行）

主循环负责收获 / 卖出 / 种植。常驻模式同时跑两个独立定时器：

- **每 10 分钟**检查页面上的 `一键务农` 按钮，命中则执行并累计次数（不发通知）
- **每天 09:00** 发送一次当日汇总通知（收获轮数 / 种植 / 卖出总额估算 / 务农次数 / 异常次数 / 当前农场状态）

常规的"每轮完成"和"心跳"不再单独通知，避免打扰。异常情况（见下文）仍即时告警。

所有普通运行参数都写在 `farm-config.json`。不要用临时环境变量启动脚本。

常用配置：

```json
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
    "maxSeedPrice": 8,
    "recalcAfterSuccessfulPlantRounds": 6
  }
}
```

配置含义：

- `chrome.debugPort`：专用 Chrome 的 CDP 端口
- `chrome.chromePath`：Chrome 程序路径；默认会自动找 macOS 常见安装位置，找不到时在这里填写
- `timing.intervalMinutes`：读取不到剩余时间时的兜底检查间隔
- `timing.matureBufferSeconds`：成熟时间之后额外等待的缓冲秒数
- `timing.actionRetryMinutes`：可收获、可种植、无库存等动作状态后的下一轮等待分钟数
- `strategy.plantCrop`：`auto` 自动选收益最高作物；也可以写 `南瓜`、`番茄` 等固定作物
- `strategy.maxSeedPrice`：参与自动策略的图鉴种子价格上限
- `strategy.recalcAfterSuccessfulPlantRounds`：成功种植多少轮后重算策略

留种数 = 实际地块数（每块地留 1 个种），从农场页面动态读取，不可配置；读不到时重试最多 10 次。

也可以只启动专用 Chrome，不执行农场流程：

```bash
npm run chrome
```

登录态会保存在 `chrome-profile/`，后续运行继续复用这个专用 Chrome profile。

## Telegram 通知

通知配置写在 `farm-config.local.json`（不入库，含敏感信息）：

```json
{
  "telegram": {
    "botToken": "你的 bot token",
    "chatId": "你的 chat id"
  }
}
```

**通知策略（一天一次汇总，避免打扰）**：

- **每天 09:00** 发送当日汇总（收获轮数 / 种植 / 卖出总额估算 / 务农次数 / 异常次数 / 当前农场状态）
- **异常即时告警**：需要人工登录或 Cloudflare 验证、连续失败可能崩溃、拒绝了花钱弹窗
- 常规的"每轮完成""心跳"不再单独通知

> 国内网络无法直连 `api.telegram.org`，`notify` 函数已内置代理前缀。如需更换代理，改 `scripts/farm-bot.js` 里 `notify` 的 `apiUrl`。

## 规则

- 先进入主页 `https://cdk.hybgzs.com/`
- 如果需要登录或授权，等待你手动完成
- 登录后点击 `进入农场`
- 如果 `一键收获` 可点击，优先点击
- 收获后进入交易所，只卖本轮收获的作物，每种保留 6 个作为下次种子
- 默认每成功种植 6 轮后，按 `图鉴成本 + 交易所现价` 重新计算收益最高的普通作物
- 如果有空闲地，点击第一个 `种植`
- 6 轮重算周期内只种当前锁定作物；只有重算后发现新作物收益最高，才允许切换
- 点击 `最大`
- 点击 `种植 xN`
- 如果当前锁定作物没能确认选中，本轮停止并等待下一轮重试，不自动改种其他作物

本地状态保存在 `data/farm-state.json`，图鉴数据保存在 `data/farm-crops.json`。

## 可选

延长等待登录超时时间，单位毫秒：

```json
{
  "timing": {
    "manualTimeoutMs": 1200000
  }
}
```
