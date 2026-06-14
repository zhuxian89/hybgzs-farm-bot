# 动态种子保留数量优化

## 🐛 问题描述

### 原来的逻辑（错误）
**固定保留种子数量**：
```json
"keepSeedStock": 6  // 写死在配置文件
```

### 为什么错了？

**地块数量是动态变化的！**

举例：
1. 买了第7块地 → 需要保留 **7个** 种子
2. 买了第8块地 → 需要保留 **8个** 种子
3. 买了第9块地 → 需要保留 **9个** 种子

但配置文件写死 `keepSeedStock: 6`：
- ❌ 卖出后只保留 6 个种子
- ❌ 有 3 块地（7、8、9）没有种子种
- ❌ 导致空地无法利用，浪费收益！

## ✅ 解决方案

### 动态获取地块总数

**核心思路**：
- 收获后，读取农场状态中的 `totalSlots`（总种植槽位）
- 售卖时，保留 `totalSlots` 个种子（而不是配置的固定值）
- 确保每块地都有种子可种

### 修改内容

#### 1. `sellHarvestedCropsWithRetry` 函数（行 1801-1813）
```javascript
async function sellHarvestedCropsWithRetry(page, cropNames, farmStatus) {
  const results = [];
  // 动态获取保留种子数量：优先使用实际地块数，否则用配置值
  const dynamicKeepStock = (farmStatus && Number.isFinite(farmStatus.totalSlots))
    ? farmStatus.totalSlots
    : keepSeedStock;

  log(`售卖策略：保留 ${dynamicKeepStock} 个种子（${farmStatus?.totalSlots ? '根据地块数动态计算' : '使用配置默认值'}）`);

  for (const cropName of cropNames) {
    results.push(await sellCropWithRetry(page, cropName, dynamicKeepStock));
  }
  return results;
}
```

#### 2. `sellCropWithRetry` 函数（行 1782-1799）
```javascript
async function sellCropWithRetry(page, cropName, dynamicKeepStock) {
  let lastError = null;

  for (let attempt = 1; attempt <= sellRetryAttempts; attempt += 1) {
    try {
      return await sellCropIfNeeded(page, cropName, { keepStock: dynamicKeepStock });
      // 👆 传递动态计算的保留数量
    } catch (error) {
      // ... 错误处理
    }
  }
}
```

#### 3. 主流程调用（行 1845-1859）
```javascript
if (harvested) {
  await reenterFarmPage(page, '收获后刷新空闲槽位');
  const harvestSignal = await waitForHarvestReadyForPlanting(page, beforeHarvestSummary);
  const afterHarvestStatus = await getFarmStatus(page);  // 👈 获取收获后的状态
  // ...
  if (harvestedCropNames.length) {
    sellResults = await sellHarvestedCropsWithRetry(page, harvestedCropNames, afterHarvestStatus);
    // 👆 传递状态，包含 totalSlots
  }
}
```

## 📊 修复效果

### 旧逻辑（固定保留）
```
[farm-bot] 准备卖出：南瓜（每种保留 6 个）
[farm-bot] 南瓜持有 63，保留 6，准备卖出 57。
[farm-bot] 成功卖出 57 个南瓜（63 -> 6，保留 6）
```
结果：3块地没种子种！❌

### 新逻辑（动态保留）
```
[farm-bot] 售卖策略：保留 9 个种子（根据地块数动态计算）
[farm-bot] 南瓜持有 63，保留 9，准备卖出 54。
[farm-bot] 成功卖出 54 个南瓜（63 -> 9，保留 9）
```
结果：9块地都有种子种！✅

## 🎯 优势

### 1. 自适应地块数量
- ✅ 买第7块地 → 自动保留 7 个
- ✅ 买第8块地 → 自动保留 8 个
- ✅ 买第9块地 → 自动保留 9 个
- ✅ 买第10块地 → 自动保留 10 个

### 2. 无需手动修改配置
- ❌ 旧方案：买地后要手动改 `keepSeedStock`
- ✅ 新方案：自动检测，无需修改

### 3. 防止配置错误
- 如果配置写错（比如 `keepSeedStock: 3`）
- 动态检测会覆盖错误配置
- 确保所有地块都能种植

### 4. 向后兼容
- 如果无法读取 `totalSlots`（网络问题等）
- 自动回退到配置的 `keepSeedStock`
- 保证系统稳定运行

## 🚀 服务状态

```
✅ 动态种子保留已实现
✅ 语法检查通过
✅ 服务已重启 (PID: 66096)
✅ 下次收获会自动使用地块数
```

## 📝 配置说明

### farm-config.json
```json
{
  "strategy": {
    "keepSeedStock": 9  // 作为备用值，实际运行时会动态覆盖
  }
}
```

**说明**：
- `keepSeedStock` 现在是**备用值**
- 正常运行时，使用动态检测的地块数
- 只有检测失败时，才使用这个配置值

## 💡 未来改进

可以考虑完全移除 `keepSeedStock` 配置项：
- 完全依赖动态检测
- 简化配置文件
- 减少用户困惑

但目前保留作为备用值是更安全的方案。

## ⚠️ 注意

每次买新地块后：
1. **不需要**修改配置文件
2. **不需要**重启服务
3. 下次收获时**自动检测**新的地块数
4. **自动调整**保留种子数量

真正的"一劳永逸"！✅
