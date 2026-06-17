# 售卖输入框数量设置失败修复

## 🐛 问题描述

### 现象

改种南瓜后，**每次都显示"本轮未触发卖出"**，南瓜库存累积到 160 个！

### 日志分析

```
[farm-bot] 南瓜持有 160，保留 10，准备卖出 150。
[farm-bot] 卖南瓜第 1/2 次失败：数量设置未生效。
期望：选中 150，库存 160
实际：{"selected":0,"stock":160}
原始错误：等待超时：数量设置生效
```

### 根本原因

**输入框设置了值，但页面没有触发验证更新！**

1. `setCropQuantityInQuickSell` 设置 `input.value = 150`
2. 触发了 `input`/`change`/`blur` 事件
3. **但页面的 React/Vue 状态没有更新**
4. 读取时 `selected` 仍然是 0
5. 验证失败，放弃售卖

### 为什么番茄没问题？

**数量不同**：
- 番茄：卖出 40 个（较小）
- 南瓜：卖出 150 个（较大）

可能触发了不同的处理逻辑或者较大数值需要更多时间更新。

## ✅ 修复方案

### 改进 1：完整的事件序列

**位置**：`scripts/farm-bot.js` 行 1702-1767

**新增**：
```javascript
// 1. 先聚焦
input.focus();

// 2. 清空现有值
input.value = '';
input.dispatchEvent(new Event('input', { bubbles: true }));

// 3. 设置新值
const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
if (setter) setter.call(input, String(quantity));
else input.value = String(quantity);

// 4. 触发所有可能的事件
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
input.dispatchEvent(new Event('blur', { bubbles: true }));

// 5. 失焦
input.blur();
```

### 改进 2：等待页面更新

**位置**：`scripts/farm-bot.js` 行 1838-1853

**新增**：
```javascript
const selected = await setCropQuantityInQuickSell(page, cropName, sellQuantity);
if (!selected.selected) {
  throw new Error(`快速卖出弹窗没有找到可设置数量的${cropName}行`);
}

// 等待页面更新（重要：给页面时间处理事件和更新显示）
await sleep(2000);  // 👈 新增：等待 2 秒

let lastSelection = null;
try {
  await waitUntil('数量设置生效', async () => {
    lastSelection = await readQuickSellCropSelection(page, cropName);
    return lastSelection && lastSelection.stock === beforeHolding 
           && lastSelection.selected === sellQuantity;
  }, 5000);
```

## 🔍 改进细节

### 事件顺序的重要性

**旧代码**（不完整）：
```javascript
input.value = String(quantity);
input.dispatchEvent(new Event('input', { bubbles: true }));
input.dispatchEvent(new Event('change', { bubbles: true }));
input.dispatchEvent(new Event('blur', { bubbles: true }));
```

**新代码**（完整）：
```javascript
1. focus()           // 聚焦
2. value = ''        // 清空
3. input event       // 通知清空
4. value = quantity  // 设置新值
5. input event       // 通知输入
6. change event      // 通知变化
7. keydown Enter     // 模拟回车按下
8. keyup Enter       // 模拟回车抬起
9. blur event        // 通知失焦
10. blur()           // 真正失焦
```

### 为什么要等待 2 秒？

**页面可能的处理流程**：
1. 接收事件
2. 验证输入值
3. 更新 React/Vue 状态
4. 重新渲染 DOM
5. 显示"已选 150"

这个过程需要时间，尤其是较大的数值！

### 为什么要清空再设置？

某些框架的输入组件会：
- 比较新旧值
- 如果值没变，跳过更新

先清空确保：
- 旧值变成 ""
- 新值 "150" 一定被识别为变化
- 触发完整的更新流程

## 📊 预期效果

### 修复后的流程

```
1. 收获南瓜 → 库存 160
2. 进入交易所 → 读取库存 160
3. 打开快速卖出
4. 设置卖出数量 150
   - 聚焦输入框
   - 清空 → 设置 150
   - 触发完整事件序列
5. **等待 2 秒** ⬅️ 新增
6. 验证：已选 150 ✅
7. 点击"确认卖出"
8. 等待 10 秒
9. 验证：库存变为 10 ✅
10. 售卖成功！
```

### 日志示例（预期）

```
[farm-bot] 南瓜持有 160，保留 10，准备卖出 150。
[farm-bot] 确认 确认卖出（1 种 · $175.5）
[farm-bot] 等待售卖完成...
[farm-bot] 成功卖出 150 个南瓜（160 -> 10，保留 10）
```

## 🚀 服务状态

```
✅ 完整的事件序列
✅ 等待页面更新
✅ 语法检查通过
✅ 锁文件已清理
✅ 服务已重启 (PID: 74656)
```

## 📝 测试建议

下次收获后（约 1-2 小时后），观察日志：
1. 应该看到 `等待售卖完成...`
2. 应该看到 `成功卖出 X 个南瓜`
3. 库存正确减少到 10

## ⚠️ 教训

**浏览器自动化的关键原则**：

1. **完整的事件序列** - 不仅仅是设置值，还要模拟用户操作
2. **等待页面更新** - 给框架足够时间处理事件
3. **先清空再设置** - 确保触发变化检测
4. **多种事件类型** - input、change、blur、keydown、keyup

**不要假设简单的 `value = X` 就够了！**

现代 Web 框架（React/Vue）需要特定的事件序列才能正确更新状态。
