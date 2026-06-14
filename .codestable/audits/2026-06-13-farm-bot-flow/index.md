---
doc_type: audit-index
audit: 2026-06-13-farm-bot-flow
scope: 农场自动化主流程的等待、恢复、收获、种植、状态读取与 Telegram 通知可靠性
created: 2026-06-13
status: active
total_findings: 7
---

# farm-bot-flow 审计报告

## 范围

本次只审计会影响农场脚本流程稳定性的代码路径：`scripts/farm-bot.js` 的 CDP 通信、页面等待、登录/安全验证处理、收获、种植、状态读取、常驻循环恢复，以及 `scripts/chrome-launcher.js` 与 `README.md` 中和运行方式相关的约定。

用户给出的硬要求作为审计基准：除 Cloudflare 安全验证和需要输入 Google 密码这两类必须人工处理的情况外，其他流程异常不能长时间死等；每做一步都应有预期界面结果，没有预期结果就重进主页/农场或重建连接；必须人工处理的情况需要发送 Telegram 通知。

## 总评

共发现 7 条流程相关问题：1 条 P0、5 条 P1、1 条 P2。最需要先处理的是 CDP 请求缺少关闭/超时兜底，WebSocket 断开或 Chrome 卡住时 Promise 可能永远不返回，这正是常驻脚本“死等几个小时”的典型根因。其次是失败恢复策略不够像人：本轮异常后复用同一个页面、按 10 分钟 fallback 等待，而不是立刻从主页/农场重新开始；收获和种植也都存在“点击了就当成功”的误判点。

## 发现清单

| # | 性质 | 严重度 | 置信度 | 标题 | 文件 |
|---|---|---|---|---|---|
| 1 | bug | P0 | high | CDP 请求没有关闭/超时兜底，WebSocket 异常时可能无限卡住 | [finding-01.md](finding-01.md) |
| 2 | bug | P1 | high | 人工等待范围过宽且默认 10 分钟，非人工异常也会进入长等待 | [finding-02.md](finding-02.md) |
| 3 | bug | P1 | high | 常驻模式本轮失败后不重建页面连接，下一轮继续使用坏状态 | [finding-03.md](finding-03.md) |
| 4 | bug | P1 | medium | 一键收获点击后立即宣告成功，未验证预期结果 | [finding-04.md](finding-04.md) |
| 5 | bug | P1 | medium | 种植流程点击确认后未验证结果，且“最大”按钮选择过宽 | [finding-05.md](finding-05.md) |
| 6 | bug | P1 | medium | 农场统计解析过于宽松，可能误判状态并算错下一轮时间 | [finding-06.md](finding-06.md) |
| 7 | maintainability | P2 | high | 主脚本职责过多，隐式流程状态使恢复策略难以保证一致 | [finding-07.md](finding-07.md) |

## 按维度分布

| 性质 | P0 | P1 | P2 | 合计 |
|---|---|---|---|---|
| bug | 1 | 5 | 0 | 6 |
| security | 0 | 0 | 0 | 0 |
| performance | 0 | 0 | 0 | 0 |
| maintainability | 0 | 0 | 1 | 1 |
| arch-drift | 0 | 0 | 0 | 0 |
| **合计** | **1** | **5** | **1** | **7** |

## 下一步建议

- **P0 立刻修**：Finding 01。给每个 CDP command 加超时，WebSocket `close/error` 时 reject 所有 pending；常驻模式发现连接坏掉后重连/重开页面。
- **P1 本迭代修**：Finding 02-06。把流程改成“动作 -> 等预期结果 -> 不符合就重进/重试有限次数 -> 失败通知并进入下一轮”，只允许 Cloudflare 和 Google 密码页进入人工等待。
- **P2 有空再看**：Finding 07。把脚本拆出 CDP 客户端、页面状态识别、农场动作、调度器、通知器，减少后续改一处崩另一处的概率。
