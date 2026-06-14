# P1/P2 关键问题修复总结

## 修复的问题

### P1 问题（严重，已修复）✅

#### 1. 收获前先读取基准 ✅
**位置**: `harvestIfPossible()` (行 972-1024)

**问题**: 
- `beforeSummary` 是在点击「一键收获」**之后**才读取
- 导致"可收获下降 / 空闲槽位增加"的对比基准不可靠

**修复**:
```javascript
// 修复后：先读基准，再点击
async function harvestIfPossible(page, { expectHarvestable = false } = {}) {
  // 先读取收获前的基准数据
  const beforeSummary = await readFarmSummary(page).catch(() => ({}));

  const clickResult = expectHarvestable
    ? await waitHumanUi('「一键收获」按钮可点击', async () => {
      const result = await clickHarvestButtonOnce(page);
      return result === 'clicked' ? result : null;
    }, { throwOnTimeout: false })
    : await clickHarvestButtonOnce(page);

  if (clickResult === 'clicked') {
    log('「一键收获」可点击，先收获。');
    await dismissNotice(page);
    // 等待统计变化
    await waitUntil('收获操作完成，页面状态改变', async () => {
      const summary = await readFarmSummary(page);
      const harvestableDropped = summary['可收获'] < beforeSummary['可收获'];
      const emptySlotsIncreased = summary['空闲槽位'] > beforeSummary['空闲槽位'];
      ...
    });
  }
}
```

---

#### 2. 种植相关等待改为配置的 10 秒 x 5 次 ✅
**位置**: 
- `waitForPlantDialogReady()` (行 683-689)
- `waitForPlantConfirmReady()` (行 691-697)
- `waitForPlantSelectionApplied()` (行 1311-1325)

**问题**:
- 3 个关键等待写死成 `{ attempts: 5, interval: 1000 }`（5 次 x 1 秒）
- 与配置的 `uiWaitSeconds: 10, uiWaitAttempts: 5` 不一致
- 可能复现"页面已选南瓜但脚本没看到就刷新"的问题

**修复**:
```javascript
// 修复前
{ attempts: 5, interval: 1000, throwOnTimeout: false }

// 修复后：使用配置变量
{ attempts: uiWaitAttempts, interval: uiWaitIntervalMs, throwOnTimeout: false }
// uiWaitAttempts = 5（默认）
// uiWaitIntervalMs = 10000（默认 10 秒）
```

现在所有种植相关等待都是 **10 秒 x 5 次 = 50 秒总超时**，与配置一致。

---

### P2 问题（次要，已修复）✅

#### 3. TG 通知只发最终汇总 ✅
**位置**: `runFarmOnce()` (行 1750-1764)

**问题**:
- 收获成功后先发一条 TG
- 本轮完成又发一条 TG
- 与"只给最终成功或失败通知"的原则不符

**修复**:
```javascript
// 修复前
await notify([
  '一键收获成功，农场已刷新出可继续种植状态。',
  ...
].filter(Boolean).join('\n'));

// 修复后：改为 log
log([
  '一键收获成功，农场已刷新出可继续种植状态。',
  ...
].filter(Boolean).join('\n'));
```

现在只在本轮完成时发一次完整汇总，中间状态只记录日志。

---

#### 4. 连续失败时才发 TG 通知 ✅
**位置**: `main()` (行 1831-1865)

**问题**:
- 每次失败都发 TG，持续失败会频繁骚扰
- 应该只在连续失败达到阈值时发送

**修复**:
```javascript
// 修复后
let consecutiveFailures = 0;

try {
  result = await runFarmOnce(page);
  consecutiveFailures = 0;  // 成功时清零
} catch (error) {
  failed = true;
  consecutiveFailures += 1;
  console.error(`[farm-bot] 本轮失败（连续 ${consecutiveFailures} 次）：${error.message}`);
  
  // 只在连续失败 >= 3 次时发 TG
  if (consecutiveFailures >= 3) {
    await notify(`连续失败 ${consecutiveFailures} 次：${error.message}\n${failureRetrySeconds} 秒后会打开新标签页，并从主页重新开始。`);
  }
  ...
}
```

现在失败会快速重试，但 TG 只在**连续失败 3 次**时发送，避免频繁打扰。

---

## 验证结果

### 语法检查 ✅
```bash
node --check scripts/farm-bot.js
# 通过，无错误
```

### 服务状态 ✅
```
状态: running
PID: 78795（已更新）
```

### 配置确认
```javascript
// farm-config.js 中的配置
uiWaitSeconds: 10      // 每次等待 10 秒
uiWaitAttempts: 5      // 最多重试 5 次
// 总超时 = 10s * 5 = 50s
```

---

## 修复总结

### P1 问题（全部修复）
1. ✅ 收获前先读取基准 - 对比基准现在可靠
2. ✅ 种植等待改为配置 - 现在是 10 秒 x 5 次 = 50 秒

### P2 问题（全部修复）
3. ✅ TG 只发最终汇总 - 中间状态改为 log
4. ✅ 连续失败才通知 - 阈值设为 3 次

### 核心改进
1. **可靠的基准对比** - 收获前先读取，点击后等变化
2. **一致的等待策略** - 所有 UI 等待都使用配置值
3. **精简的通知** - 只发关键信息，避免骚扰

### 下一步
等待作物成熟后的真实验证，观察新的种植链路是否稳定。
