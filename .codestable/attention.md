# Attention

本文件是 CodeStable 技能启动必读的项目注意事项入口。所有 CodeStable 子技能开始工作前必须读取它。

## 项目碎片知识

<!-- cs-note managed: 用 cs-note 维护，新条目按下面分节追加 -->

### 编译与构建

- 项目是 Node.js ESM 脚本，依赖安装使用 `npm install`。
- 语法检查使用 `node --check scripts/farm-bot.js`。

### 运行与本地起服务

- 单次农场流程：`npm run farm`。
- 常驻农场流程：`npm run farm:watch`。
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
