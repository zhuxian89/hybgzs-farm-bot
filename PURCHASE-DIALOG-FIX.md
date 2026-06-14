# 购买确认弹窗处理添加

## 问题现象

从截图和日志看：
1. ✅ 脚本成功点击了 `种植 x6（需购买 6 个）` 按钮
2. ❌ 出现了购买确认弹窗：`库存不足，需购买差额`
3. ❌ 弹窗没有被处理，脚本直接继续执行验证，导致种植失败

日志显示：
```
[farm-bot] 确认 种植 x6（需购买 6 个）
[farm-bot] 重新进入农场：种植后验证结果
[farm-bot] 种植候选作物（南瓜）第 3/3 次失败：等待超时：种植后南瓜进入生长状态
```

## 根本原因

### 购买确认弹窗是页面元素，不是浏览器原生弹窗

**弹窗内容**：
```
⚠️ 库存不足，需购买差额
确认要花费黑白币购买 6 个「南瓜」种子并种植 6 个吗？

计划种植         6 个
当前库存         0 个
需购买          6 个
将扣除黑白币     -$24.00
当前余额        $717.76

[取消]  [确认购买并种植]
```

**问题**：
- 这是页面自己实现的模态框（React/Vue 组件）
- 不是浏览器原生的 `alert` 或 `confirm`
- `Page.handleJavaScriptDialog` 无法处理页面元素弹窗
- 需要手动点击 `确认购买并种植` 按钮

### 为什么 allowSpendConfirm 没生效

`page.allowSpendConfirm()` 只能允许**浏览器原生弹窗**（`window.confirm`），但这个是**页面元素弹窗**，所以该机制无效。

## 修复方案

### 添加购买确认弹窗处理逻辑

在点击 `种植 x6` 确认按钮后，添加检测和处理购买确认弹窗的逻辑：

```javascript
log(`确认 ${label}`);
try {
  await dismissNotice(page);

  // 等待并处理可能出现的购买确认弹窗
  const hasPurchaseDialog = await waitHumanUi('检查是否有购买确认弹窗', async () => {
    const bodyText = await page.bodyText();
    return bodyText.includes('库存不足') && bodyText.includes('需购买') ? true : null;
  }, { attempts: 2, interval: 1000, throwOnTimeout: false });

  if (hasPurchaseDialog) {
    log('检测到购买确认弹窗，点击「确认购买并种植」。');
    const clicked = await clickByText(page, '确认购买并种植', { exact: false, buttonOnly: true });
    if (!clicked) {
      throw new Error('购买确认弹窗出现，但未找到「确认购买并种植」按钮。');
    }
    await sleep(1000);
    await dismissNotice(page);
  }

  await reenterFarmPage(page, '种植后验证结果');
  await waitForPlantApplied(page, beforeStatus, selectedCropName);
} finally {
  page.clearSpendConfirm();
}
```

### 处理流程

1. **点击种植确认按钮** (`种植 x6（需购买 6 个）`)
2. **检测购买确认弹窗** - 检查页面是否包含 `库存不足` + `需购买`
3. **点击确认购买** - 如果弹窗出现，点击 `确认购买并种植` 按钮
4. **等待弹窗消失** - sleep 1 秒并 dismissNotice
5. **验证种植结果** - reenterFarmPage 并等待作物进入生长状态

### 关键改进

**之前 ❌**:
```javascript
log(`确认 ${label}`);
await dismissNotice(page);
await reenterFarmPage(page, '种植后验证结果');  // 直接验证，忽略了购买弹窗
```

**现在 ✅**:
```javascript
log(`确认 ${label}`);
await dismissNotice(page);

// 检测并处理购买确认弹窗
if (hasPurchaseDialog) {
  log('检测到购买确认弹窗，点击「确认购买并种植」。');
  await clickByText(page, '确认购买并种植', ...);
  await sleep(1000);
}

await reenterFarmPage(page, '种植后验证结果');
```

## 预期效果

修复后，当库存不足需要购买时：
1. ✅ 点击 `种植 x6（需购买 6 个）`
2. ✅ 检测到购买确认弹窗
3. ✅ 自动点击 `确认购买并种植`
4. ✅ 等待弹窗消失
5. ✅ 验证种植成功

## 服务状态
```
✅ 语法检查通过
✅ 服务已重启 (PID: 96289)
✅ 修复已生效
```

## 相关修复历史

这是第三次关键修复：
1. **第一次** - 改进"已选中"状态识别（检查数量控件）
2. **第二次** - 改进确认按钮识别（允许按钮文字有额外内容）
3. **第三次** - 添加购买确认弹窗处理（点击"确认购买并种植"）

三次修复结合，应该能完整解决整个种植流程。
