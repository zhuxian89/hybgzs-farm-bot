# Code Review 问题修复总结

## 修复的问题

### P1 问题（严重）

#### 1. 收获后的无效验收 ✅
**位置**: `harvestIfPossible()` (行 943-981)

**问题**: 
- 点击一键收获后只等 `readFarmSummary()` 返回完整数据
- 这个条件点击前就满足，不能证明收获完成
- 之前遇到过"收获点了但统计没刷新"的问题

**修复**: 
- 收获前先读取 `beforeSummary`
- 等待以下任一条件满足：
  - 可收获数量下降
  - 空闲槽位增加
  - 出现可点击的「种植」按钮
- 这些才是真正的收获完成信号

```javascript
// 修复后
const beforeSummary = await readFarmSummary(page).catch(() => ({}));
await waitUntil('收获操作完成，页面状态改变', async () => {
  const summary = await readFarmSummary(page);
  const harvestableDropped = summary['可收获'] < beforeSummary['可收获'];
  const emptySlotsIncreased = summary['空闲槽位'] > beforeSummary['空闲槽位'];
  const hasPlantButton = await page.evaluate(...);
  return harvestableDropped || emptySlotsIncreased || hasPlantButton;
}, 10000);
```

---

#### 2. dismissNotice() 误判公告已关闭 ✅
**位置**: `dismissNotice()` (行 503-522)

**问题**:
- 用 `bodyText.includes('我知道了')` 判断弹窗是否消失
- 如果页面其他地方也有这个文本，会误判
- `.catch(() => {})` 吞掉错误，后续继续执行

**修复**:
- 检查**可见的按钮元素**是否存在「我知道了」
- 不再检查全文本
- 失败时记录日志，不再静默吞掉

```javascript
// 修复后
await waitUntil('公告弹窗关闭', async () => {
  const hasButton = await page.evaluate(`(() => {
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'));
    return buttons.some((el) => {
      const visible = ...;  // 检查元素可见性
      const text = (el.innerText || '').trim();
      return visible && text === '我知道了';
    });
  })()`);
  return !hasButton;
}, 5000);
```

---

#### 3. goto() 过宽的验收 ✅
**位置**: `goto()` (行 450-462)

**问题**:
- 只等 `document.readyState === 'complete'`
- SPA 页面 URL 变了不代表业务内容已渲染
- 调用者可能误以为页面"真正加载完成"

**修复**:
- 添加清晰的注释说明这只是 DOM 基础加载
- 强调调用者必须额外调用业务页面的 ready 检查：
  - `FARM_URL` → `waitForFarmReady()`
  - `RECYCLE_URL` → `waitForRecycleReady()`
  - 登录流程 → `ensureDashboardOrFarmPage()`

```javascript
// 修复后增加注释
async goto(url) {
  await this.send('Page.navigate', { url });
  // 注意：这里只等待 DOM readyState，不等待 SPA 业务内容渲染
  // 调用者必须额外调用业务页面的 ready 检查函数
  await waitUntil('DOM 基础加载完成', ...);
}
```

---

#### 4. 种植选择验收改进 ✅
**位置**: `isCropSelectedForPlanting()` 和 `waitForPlantSelectionApplied()` (行 713-756, 1303-1316)

**问题**:
- `selectCropForPlanting()` 只返回"点击事件已发出"，不是"作物已选中"
- `waitForPlantSelectionApplied()` 只等 3 秒
- 不支持多种文本模式
- 失败时没有调试信息

**修复**:
- **增加多种识别模式**：
  - 模式1: "已选 作物名"
  - 模式2: "已选：作物名"（支持中英文冒号）
  - 模式3: 区域包含"作物名 + 种植数量"
  - 模式4: 确认按钮父级包含"作物名 + 种植数量"
- **增加重试次数**: 3 → 5 次
- **失败时记录页面片段**，方便调试

```javascript
// 修复后
if (new RegExp('已选\\s*' + cropName).test(bodyText)) return true;
if (new RegExp('已选[:：]\\s*' + cropName).test(bodyText)) return true;
// ... 其他模式

// 失败时记录调试信息
if (attempt >= 3) {
  const bodySnippet = await page.evaluate(...);
  log(`未识别到${cropName}已选中。页面片段：${bodySnippet}`);
}
```

---

### P2 问题（次要）

#### 5. 移除重试前的固定 sleep ✅
**位置**: `plantCropWithRetry()`, `sellCropWithRetry()` (行 1392-1410, 1705-1722)

**问题**:
- 重试前有 `await sleep(1000)`
- 虽然只是节流，但与"所有点击后等结果"的原则不符

**修复**:
- 移除 `sleep(1000)`
- 直接调用 `reenterFarmPage()` / `enterRecyclePage()`
- 这些函数本身已经等待页面 ready

```javascript
// 修复前
if (attempt < plantRetryAttempts) {
  await sleep(1000);
  await reenterFarmPage(page, ...);
}

// 修复后
if (attempt < plantRetryAttempts) {
  await reenterFarmPage(page, ...);
}
```

---

#### 6. openQuickSellDialog() 避免重复点击 ✅
**位置**: `openQuickSellDialog()` (行 1547-1559)

**问题**:
- 在 `waitHumanUi` 的 predicate 内部点击
- 每次重试都会再次点击「快速卖出」
- 可能造成状态抖动

**修复**:
- 先点击一次
- 然后单独 wait 弹窗内容
- 避免重复点击

```javascript
// 修复后
await dismissNotice(page);
const opened = await clickEnabledButtonExact(page, '快速卖出');
if (!opened) {
  throw new Error('没有找到可点击的「快速卖出」按钮');
}

return waitHumanUi('快速卖出弹窗加载完成', async () => {
  await dismissNotice(page);
  const bodyText = await page.bodyText();
  return bodyText.includes('勾选作物并调整数量') ? true : null;
});
```

---

#### 7. 卖出数量设置验收信息改进 ✅
**位置**: `sellCropIfNeeded()` (行 1655-1673)

**问题**:
- 等待超时只显示"等待超时：数量设置生效"
- 没有当前 selection 的值
- 无法判断是没选作物、输入没触发，还是库存解析错

**修复**:
- 保留最后一次读取的 `lastSelection`
- 失败时输出详细信息：期望值 vs 实际值

```javascript
// 修复后
let lastSelection = null;
try {
  await waitUntil('数量设置生效', async () => {
    lastSelection = await readQuickSellCropSelection(page, cropName);
    return lastSelection && lastSelection.stock === beforeHolding && lastSelection.selected === sellQuantity;
  }, 5000);
} catch (error) {
  throw new Error(`数量设置未生效。期望：选中 ${sellQuantity}，库存 ${beforeHolding}；实际：${JSON.stringify(lastSelection)}。原始错误：${error.message}`);
}
```

---

## 总结

### 修复统计
- ✅ 7 个问题全部修复
- ✅ 4 个 P1 严重问题
- ✅ 3 个 P2 次要问题

### 核心改进
1. **真实的状态验收**：不再等待"可能已经满足的条件"，而是等待"操作带来的变化"
2. **更精确的元素判断**：从全文本匹配改为可见元素检查
3. **更好的错误信息**：失败时记录详细的当前状态和期望状态
4. **清晰的注释说明**：避免误用底层函数
5. **避免重复操作**：点击只做一次，然后等待结果

### 服务状态
已通过 `launchctl kickstart -k` 重启服务，修复已生效。

### 监控命令
```bash
tail -f /Users/hongweizhang/java_project/hybgzs-farm-bot/logs/farm-watch.log
```
