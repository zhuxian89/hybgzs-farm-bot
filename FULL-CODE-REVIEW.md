# 全面 Code Review 发现的问题

## P1 问题（严重）

### 1. ensureDashboardOrFarmPage() 中的静默错误吞没 ⚠️
**位置**: 行 928

**问题**:
```javascript
await waitUntil('登录流程推进后出现下一步页面', async () => {
  const nextState = await getPageState(page);
  return nextState.type !== state.type || ['dashboard', 'farm', 'security', 'google-password'].includes(nextState.type);
}, 15000).catch(() => {});  // ❌ 静默吞掉超时错误
state = await getPageState(page);
```

**为什么这是严重问题**：
1. `advanceLoginFlow()` 执行后，应该等待页面真正跳转
2. 如果 15 秒内没跳转，说明登录操作失败了
3. 但 `.catch(() => {})` 把错误吞掉了
4. 后续 `state = await getPageState(page)` 可能读到旧状态
5. 循环会继续，可能重复点击同一个按钮

**影响**：
- 登录卡住时不会及时报错
- 可能导致无限循环点击
- 浪费时间和资源

**修复建议**：
```javascript
// 方案1: 不要 catch，让它抛出异常，外层会处理
await waitUntil('登录流程推进后出现下一步页面', async () => {
  const nextState = await getPageState(page);
  return nextState.type !== state.type || ['dashboard', 'farm', 'security', 'google-password'].includes(nextState.type);
}, 15000);
state = await getPageState(page);

// 方案2: catch 后记录日志并 break
try {
  await waitUntil(..., 15000);
} catch (error) {
  log(`等待页面跳转超时：${error.message}`);
  break;  // 跳出循环，让后续检查处理
}
state = await getPageState(page);
```

---

## P2 问题（次要）

### 2. notify() 失败被静默吞掉
**位置**: 行 350, 1839, 1858

**问题**:
```javascript
notify(`已拒绝疑似花钱/消耗确认弹窗。\n弹窗内容：${dialogMessage}`).catch(() => {});
await page?.close().catch(() => {});
```

**分析**:
- `notify()` 失败通常是 TG 配置问题，吞掉错误是合理的
- `page?.close()` 失败说明页面已关闭或连接断开，吞掉是合理的

**结论**: 这两处是**合理的**，保持不变。

---

## 其他检查结果 ✅

### 3. waitHumanUi 参数一致性 ✅
所有 waitHumanUi 都：
- 使用默认参数 `{ attempts: uiWaitAttempts, interval: uiWaitIntervalMs }`
- 或显式传入相同的配置
- **一致性良好**

### 4. 点击后等待结果 ✅
检查了所有点击函数：
- `clickByText` → 立即返回，由调用者等待
- `clickFirstPlantButton` → 立即返回，由 `waitForPlantDialogReady` 等待
- `clickHarvestButtonOnce` → 立即返回，由 `waitUntil` 等待收获完成
- `clickPlantMaxButton` → 立即返回，由 `waitForPlantConfirmReady` 等待
- **所有点击后都有对应的等待**

### 5. TG 通知策略 ✅
- ✅ 安全验证/密码 → 立即通知（正确）
- ✅ 连续失败 ≥3 次 → 通知（正确）
- ✅ 本轮完成 → 发送汇总（正确）
- ✅ 中间状态（收获成功）→ 只记录日志（正确）

### 6. 固定 sleep ✅
检查了所有 `await sleep`：
- 轮询间隔（waitUntil, waitHumanUi）
- 稳定性检查（waitForStableFarmSummary）
- 主循环等待下一轮
- **都是合理的**

### 7. 重复代码 ✅
- `beforeSummary` 只在收获前读取一次
- `harvestIfPossible` 已移除重复逻辑
- **无重复代码**

---

## 总结

### 需要立即修复的问题
**只有 1 个 P1 问题**：
- ⚠️ **ensureDashboardOrFarmPage() 中的 `.catch(() => {})`** - 可能导致登录卡住时无限循环

### 建议的修复方案
**方案1（推荐）**：移除 catch，让异常自然抛出
```javascript
await waitUntil('登录流程推进后出现下一步页面', async () => {
  const nextState = await getPageState(page);
  return nextState.type !== state.type || ['dashboard', 'farm', 'security', 'google-password'].includes(nextState.type);
}, 15000);
state = await getPageState(page);
```

**方案2**：catch 后记录日志并跳出循环
```javascript
try {
  await waitUntil('登录流程推进后出现下一步页面', async () => {
    const nextState = await getPageState(page);
    return nextState.type !== state.type || ['dashboard', 'farm', 'security', 'google-password'].includes(nextState.type);
  }, 15000);
} catch (error) {
  log(`登录流程推进超时（尝试 ${attempt + 1}/6）：${error.message}`);
  // 不要 break，让循环继续，但记录错误
}
state = await getPageState(page);
```

实际上，考虑到这是在 for 循环中，超时可能是正常的（网络慢、页面渲染慢），**方案2 更合适**。

### 其他方面
- ✅ 点击后等待结果 - 良好
- ✅ TG 通知策略 - 合理
- ✅ 等待参数一致性 - 良好
- ✅ 无重复代码
- ✅ 固定 sleep 都合理
