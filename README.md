# hybgzs farm bot

自动执行福利站农场的“收获 + 自动选作物补种 + 收获后卖出并保留种子”流程。

## 安装

```bash
npm install
```

## 运行

直接运行：

```bash
npm run farm
```

如果专用 Chrome 没开，脚本会自动打开。首次使用时，在打开的 Chrome 里手动完成 Cloudflare、安全验证、LinuxDo/Google 登录和授权；脚本会等待并继续。

常驻重复检查：

```bash
npm run farm:watch
```

常驻模式会优先读取页面里的 `剩余` 时间，等到成熟后再加 120 秒缓冲执行下一轮。读取不到剩余时间时，才使用固定间隔。

如果页面显示 `现在可收获` 或存在空闲槽位，本轮会立刻尝试收获/种植；下一轮默认 3 分钟后再检查，给页面操作留缓冲。

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
    "recalcAfterSuccessfulPlantRounds": 6,
    "keepSeedStock": 6
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
- `strategy.keepSeedStock`：卖出时每种作物保留多少个种子

也可以只启动专用 Chrome，不执行农场流程：

```bash
npm run chrome
```

登录态会保存在 `chrome-profile/`，后续运行继续复用这个专用 Chrome profile。

## Telegram 通知

脚本会读取 `.env`：

```bash
TG_BOT_TOKEN=你的 bot token
TG_CHAT_ID=你的 chat id
```

触发通知：

- 需要 Cloudflare 安全验证、手工登录或授权
- 一键收获成功
- 本轮检查完成，包括收获、种植、卖出、策略和当前农场状态
- 单次 `npm run farm` 流程结束
- 常驻模式某一轮执行失败

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
