---
doc_type: issue-fix
issue: 2026-06-13-farm-bot-flow-recovery
path: standard
fix_date: 2026-06-13
related: [farm-bot-flow-recovery-analysis.md]
tags: [farm-bot, cdp, recovery, telegram]
---

# 农场流程恢复修复记录

## 1. 实际采用方案

采用 analysis 推荐的方案 A：集中修改 `scripts/farm-bot.js`，不引入 Playwright，不做模块拆分。修复目标是让每一步都有有限等待和预期结果验证；非人工异常走失败恢复，只有 Cloudflare 安全验证和 Google 密码输入进入人工等待并发送 Telegram 通知。

后续按用户反馈补充三点：每轮都会从主页重新进入农场以刷新成熟状态，避免停留在旧农场页面导致“一键收获”按钮未刷新；如果统计显示可收获但按钮不可用，会重进农场后再试一次；没有玉米库存时只通知并按短间隔继续检查，不退出 watch。

安全保护补充：原生弹窗中疑似花钱 / 消耗 / 支付 / 购买 / 扣除余额的确认默认拒绝并发送 Telegram 通知；唯一例外是脚本已经完成“选择玉米 → 验证当前选中玉米 → 最大 → 再次验证当前选中玉米 → 点击 `种植 xN`”的种植上下文时，允许这一次动作触发的购买/消耗确认。作物选择页里的价格列表不作为花钱确认拦截依据，避免误拦正常种植。

玉米选择保护补充：`种植 xN` 前会重新确认当前作物选择仍是玉米；确认失败时停止本轮，不点击确认，避免误选其他作物后进入购买/消耗确认。

CDP 卡顿恢复补充：`Runtime.evaluate` / `Page.navigate` 等 CDP 命令超时后会主动关闭当前 WebSocket；watch 下一轮不再复用旧 hybgzs 标签页，而是打开新标签页从主页重新开始。失败恢复间隔改为默认 10 秒，可通过 `farm-config.json` 的 `timing.failureRetrySeconds` 调整，单次流程首次遇到这类失败时也会自动换新标签页重试一次。

通知补充：watch 模式每轮成功检查后也会发送 Telegram 状态摘要，包含收获结果、种植结果、当前农场状态和下次检查时间，避免只在收获/失败时才有消息。

收获验证补充：一键收获后不再只依赖“统计卡片出现空闲槽位或可收获减少”这一个旧条件判定成功。脚本会重新进入农场，等待真正影响下一步的状态出现：空闲槽位、可点击的 `种植` 按钮、可收获减少或空闲槽位增加；如果短时间没刷新出来，会再次重新进入农场复查，避免一键收获已经生效但统计渲染滞后时被误报为失败。确认可继续种植后会立刻发送 Telegram 通知，说明收获成功、当前空闲槽位以及接下来开始种植玉米。

种植通知降噪补充：种植过程中的短暂失败不再直接发送 Telegram，例如种植按钮暂时没出现、玉米选中态暂时无法确认、`最大` 或 `种植 xN` 按钮短时间没渲染。脚本会从农场重新进入并最多重试 3 次；只有最终成功或连续重试后仍失败才通过本轮结果通知体现。真正疑似误花钱的确认弹窗仍保留即时拒绝和通知。

UI 等待节奏补充：dashboard、农场主体、一键收获按钮、收获后可继续种植状态不再使用高频短轮询或一失败就刷新。关键 UI 判断统一改为按人类操作节奏等待：每 5 秒检查一次，最多 5 次；25 秒内仍没有预期界面，才进入重新打开/重新进入农场的恢复逻辑。无可收获时不会额外等待一键收获按钮，避免空跑轮次被拖慢。

## 2. 改动文件清单

- `scripts/farm-bot.js`
- `.codestable/issues/2026-06-13-farm-bot-flow-recovery/farm-bot-flow-recovery-report.md`
- `.codestable/issues/2026-06-13-farm-bot-flow-recovery/farm-bot-flow-recovery-analysis.md`
- `.codestable/issues/2026-06-13-farm-bot-flow-recovery/farm-bot-flow-recovery-fix-note.md`

## 3. 验证结果

- `node --check scripts/farm-bot.js`：通过。
- `npm ls --depth=0`：通过，项目依赖仍只有 `ws`。
- `npm run farm` 冒烟验证：通过。脚本连接专用 Chrome，打开主页，点击进入农场，读取状态后发现一键收获不可点击且无空闲槽位，正常结束，没有卡住；重复“进入农场”点击已压掉；花钱确认保护未误伤当前无操作路径。
- `npm run farm` 种植路径验证：通过。脚本点击第一个种植、选择玉米、点击最大、确认 `种植 x6`，重进农场验证种植后状态，正常结束。
- 玉米选择二次确认后的当前状态验证：`npm run farm` 在无空闲槽位状态下正常结束；下一次有空闲槽位时会执行“选玉米后再确认选中态”的保护。
- CDP 恢复路径验证：`npm run farm` 在正常页面状态下通过；代码已覆盖 CDP 命令超时后关闭连接、watch 下一轮新标签恢复、单次流程新标签重试。
- 运行进程修正：发现旧 watch 进程仍在运行旧代码，已停止旧进程并用新代码重新启动 `caffeinate -dimsu npm run farm:watch`。首轮正常进入农场并按剩余时间等待下一轮。
- watch 状态通知验证：重启新 watch 后首轮正常完成，日志显示下次检查时间；代码已加入每轮成功 TG 摘要。
- 收获后继续种植路径修正：已移除过严的 `waitForHarvestApplied` 成功判定，改为一键收获后重进农场并等待可继续种植的真实状态；统计卡片短暂未更新时会重进复查，不再把已成功的收获误报为失败。验证出可种植状态后会先发 TG，再继续执行玉米种植。
- 种植重试与通知降噪：`plantCornIfPossible` 内部不再对普通种植失败直接发 TG，外层新增最多 3 次种植重试，每次重试都会重新进入农场；全部失败后才抛出最终错误，由 watch 的本轮失败通知统一发送。
- 页面渲染等待修正：新增统一的 `waitHumanUi`，将 dashboard 入口、farm 主体、农场统计、一键收获按钮、收获后空闲槽位等待改成 5 秒一轮、最多 5 轮；只有连续 5 轮都没有预期 UI 才刷新/重进，避免肉眼已看到按钮但脚本过早 DOM 判断失败导致频繁刷新。
- CodeStable 检索：report 和 analysis 均可通过 `.codestable/tools/search-yaml.py` 检索。

## 4. 遗留事项

- README 仍描述“登录/授权都等待手动完成”，和当前代码“自动推进 LinuxDo/Google 授权，只在 Cloudflare/Google 密码停等”不完全一致。该项是文档同步，不影响脚本运行，可后续单独补。
- `scripts/farm-bot.js` 仍是单文件多职责；审计 Finding 07 建议后续走 `cs-refactor` 拆分，但本次 issue 按最小修复原则没有处理。
