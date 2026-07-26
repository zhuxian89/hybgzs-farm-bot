# Attention

本文件是 CodeStable 技能启动必读的项目注意事项入口。所有 CodeStable 子技能开始工作前必须读取它。

## 项目碎片知识

<!-- cs-note managed: 用 cs-note 维护，新条目按下面分节追加 -->

### 编译与构建

- 项目是 Node.js ESM 脚本，依赖安装使用 `npm install`。
- 语法检查使用 `node --check scripts/farm-bot.js`。

### 运行与本地起服务

- 单次农场流程：`npm run farm`。
- 常驻农场流程（生产）：由 launchd 服务 `com.hybgzs.farm-bot` 托管（`KeepAlive` 崩溃自愈 + `RunAtLoad` 登录自启）。首次部署 `./setup-farm-bot.sh`，重启 `./start.sh`（= `launchctl kickstart -k`）。
- `npm run farm:watch` 仍可用于手动/临时前台运行，但不是受监督的生产路径（崩溃不会自动重启）。
- bot 进程由 launchd 保活；防休眠由独立服务 `com.hybgzs.caffeinate` 负责，两者分立，不要合并。
- ⚠️ `setup-farm-bot.sh` 会把当时 `command -v node` 的绝对路径烘焙进 plist；**node 升级或项目搬家后必须重跑 `./setup-farm-bot.sh`**，否则 launchd 起不来。
- 锁文件 `data/farm-watch.lock` 已处理死 PID（`acquireWatchLock` 检测持有者进程不在则覆盖），launchd 重启不会因残留锁死循环。
- ⚠️ launchd 以 **append** 方式写 `logs/farm-watch.{log,err.log}`（不像旧 `start.sh` 的 `>` 每次截断），且 KeepAlive 重拉反复追加——**日志不会自动轮转**，长期运行须定期手动清空（`> logs/farm-watch.log`）或加外置轮转。
- 脚本通过 Chrome DevTools Protocol 连接专用 Chrome，默认端口 `9222`。
- 脚本会自动启动专用 Chrome，profile 位于 `chrome-profile/`。

### 测试

- 当前没有自动化测试套件；修改脚本后至少运行 `node --check scripts/farm-bot.js`。

### 命令与脚本陷阱

- 不使用 Playwright；不要重新引入 Playwright 依赖或 Playwright API。
- 农场页面动作后倾向重新进入 `https://cdk.hybgzs.com/entertainment/farm` 获取稳定状态。
- 页面判断必须等待目标内容/统计卡片渲染完成，不要只依赖固定 sleep。
- 原生 alert 需要通过 CDP `Page.javascriptDialogOpening` 自动确认。

### 路径与目录约定

- Telegram 凭证放在 `.env`，不要提交；普通运行配置放在 `farm-config.json`。
- Chrome 登录态与缓存位于 `chrome-profile/`，不要提交。

### 配置与凭证

- Telegram 通知使用 `.env` 中的 `TG_BOT_TOKEN` 和 `TG_CHAT_ID`。
- `.env` 已加入 `.gitignore`，不要在文档或日志中回显 token。
- 普通运行配置统一写在项目根目录 `farm-config.json`；不要用临时环境变量启动脚本。
- `farm-config.json` 里的 `chrome.*` 控制专用 Chrome 端口和程序路径，`timing.*` 控制等待和重试节奏，`strategy.*` 控制作物选择、价格上限、重算轮数和保留种子数量。

### 其他

- 默认补种策略是 `auto`：按本地图鉴成本、交易所现价、产量和成熟时间计算每小时利润，普通作物且种子价格小于等于 `farm-config.json` 的 `strategy.maxSeedPrice` 才参与。
- 自动策略只在成功种植达到 `strategy.recalcAfterSuccessfulPlantRounds` 后重算；重算周期内必须锁定当前作物，不得因为 UI 失败、库存或点击失败改种候选列表里的其他作物。轮数和上次排名保存在 `data/farm-state.json`。
- 收获后只卖本轮收获作物，每种保留地块数个（每块地留 1 个种）作为下次种子；不自动购买菜场作物。
