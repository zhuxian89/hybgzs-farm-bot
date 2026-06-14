# 点击等待结果修复说明

## 修复原则
**强制要求：模拟人类操作，所有点击操作后必须循环检查页面是否出现预期结果，直到结果出现才进入下一步。**

**错误做法❌**：点击 → 固定等待N毫秒 → 继续下一步
**正确做法✅**：点击 → 循环检查预期结果是否出现 → 出现了才继续

## 已修复的问题

### 1. dismissNotice() - 点击公告关闭
- **修复前**：点击「我知道了」后固定等待 800ms
- **修复后**：点击后循环检查页面是否还有「我知道了」文本，消失了才继续
- **实现**：使用 `waitUntil` 检查 `bodyText` 不再包含「我知道了」
- **行号**：503-511

### 2. clickFarmEntry() - 进入农场
- **修复前**：点击后固定等待 1500ms
- **修复后**：点击后通过 `waitHumanUi` 循环检查，直到 `isFarmReady(page)` 返回 true
- **实现**：移除固定 sleep，直接进入 waitHumanUi 检查农场页面是否就绪
- **行号**：816-830

### 3. advanceLoginFlow() - 登录流程
- **修复前**：各个登录步骤固定等待 2000-2500ms
- **修复后**：
  - 「LinuxDo 登录」：等待 `state.type !== 'home-login'`（页面类型改变）
  - 「使用 Google 登录」：等待 `state.type !== 'linuxdo-login'`
  - Google 授权「允许/继续」：等待 `state.type !== 'google-consent'`
- **实现**：使用 `waitUntil` 检查页面状态变化
- **行号**：780-810

### 4. plantCropIfPossible() - 种植作物
- **修复前**：
  - 点击「种植」按钮后固定等待 1000ms
  - 选择作物后固定等待 800ms
  - 点击「最大」后固定等待 800ms
  - 确认种植后固定等待 2000ms
- **修复后**：
  - 点击「种植」后：通过 `waitForPlantDialogReady` 检查对话框出现
  - 选择作物后：通过 `waitForPlantSelectionApplied` 检查作物已选中
  - 点击「最大」后：通过 `waitForPlantConfirmReady` 检查确认按钮出现
  - 确认种植后：直接进入 `reenterFarmPage` 和 `waitForPlantApplied` 验证结果
- **实现**：移除所有固定 sleep，依赖现有的 wait 函数检查状态
- **行号**：1255-1318

### 5. openQuickSellDialog() - 打开快速卖出弹窗
- **修复前**：点击后固定等待 1200ms
- **修复后**：点击后使用 `waitUntil` 检查页面出现「勾选作物并调整数量」文本
- **实现**：在 `waitHumanUi` 内部增加 `waitUntil` 检查弹窗内容
- **行号**：1483-1494

### 6. sellCropIfNeeded() - 卖出作物
- **修复前**：
  - 设置数量后固定等待 800ms
  - 确认卖出后固定等待 2500ms
- **修复后**：
  - 设置数量后：使用 `waitUntil` 检查 `readQuickSellCropSelection` 返回正确的选择状态
  - 确认卖出后：直接进入 `enterRecyclePage` 和 `waitForCropHolding` 验证库存变化
- **实现**：用 `waitUntil` 替换 sleep，检查实际状态
- **行号**：1574-1631

### 7. harvestIfPossible() - 收获作物
- **修复前**：点击「一键收获」后固定等待 1500ms
- **修复后**：点击后使用 `waitUntil` 检查 `readFarmSummary` 返回完整数据
- **实现**：等待 `summaryReady(summary)` 返回 true，表示页面已刷新
- **行号**：943-981

### 8. goto() - 页面导航
- **修复前**：导航后固定等待 1500ms
- **修复后**：导航后检查 `location.href` 有值且 `document.readyState` 为 complete 或 interactive
- **实现**：使用 `waitUntil` 检查页面加载状态
- **行号**：450-456

## 核心改进

### 修复前的问题
```javascript
// ❌ 错误：固定等待，不管页面是否真的加载完成
await clickButton(page);
await sleep(2000);  // 盲目等待
doNextStep();
```

### 修复后的正确做法
```javascript
// ✅ 正确：循环检查，直到看到预期结果
await clickButton(page);
await waitUntil('等待结果出现', async () => {
  const state = await checkPageState(page);
  return state === 'ready';  // 只有返回 true 才继续
}, timeout);
doNextStep();
```

## 使用的等待函数

1. **waitUntil(description, predicate, timeout, interval)**
   - 循环执行 predicate 直到返回 true
   - 适合简单的状态检查

2. **waitHumanUi(description, predicate, options)**
   - 多次重试，带人性化的日志
   - 适合 UI 元素加载等待

3. **现有的专用等待函数**
   - `waitForPlantDialogReady` - 等待种植对话框
   - `waitForPlantSelectionApplied` - 等待作物选择生效
   - `waitForPlantConfirmReady` - 等待确认按钮
   - `waitForCropHolding` - 等待读取库存
   - `waitForFarmSummary` - 等待农场统计
   - `isFarmReady` - 检查农场页面是否就绪

## 验证要点

所有修复后的操作流程：
1. ✅ 点击操作后不再使用固定 sleep
2. ✅ 使用 waitUntil/waitHumanUi 循环检查预期状态
3. ✅ 检查条件是具体的页面状态（元素出现、文本包含、状态变化等）
4. ✅ 只有检查通过才继续下一步

## 测试建议

运行脚本观察：
- 每次点击后是否在主动检查结果
- 日志中是否显示"等待xxx"的信息
- 是否不再出现「页面还没加载完就执行下一步」的错误
- 在网络慢的情况下是否仍然可靠

## 配置文件

等待超时可通过 `farm-config.js` 中的以下参数调整：
- `timing.uiWaitSeconds`: UI 等待间隔（默认 3 秒）
- `timing.uiWaitAttempts`: UI 等待重试次数（默认 5 次）
- `timing.stepTimeoutMs`: 步骤超时时间（默认 30000ms）
- `timing.manualTimeoutMs`: 手动操作超时（默认 300000ms）

