# 自我 Review 发现并修复的问题

## 问题：harvestIfPossible() 重复且冗余的逻辑

### 发现
在 `harvestIfPossible()` 函数中，我发现了**几乎完全重复的代码块**：
- **第一段** (行 976-998): 通过 `waitHumanUi` 等按钮可点击，点击后等待结果
- **第二段** (行 1000-1016): 直接再次调用 `clickHarvestButtonOnce()`，点击后等待结果

### 问题分析
```javascript
// 第一次尝试
const clickResult = expectHarvestable
  ? await waitHumanUi('「一键收获」按钮可点击', async () => {
    const result = await clickHarvestButtonOnce(page);
    return result === 'clicked' ? result : null;
  }, { throwOnTimeout: false })
  : await clickHarvestButtonOnce(page);

if (clickResult === 'clicked') {
  // ... 等待收获完成
  return true;
}

// 问题：这里又点击一次！
const finalState = await clickHarvestButtonOnce(page);
if (finalState === 'clicked') {
  // ... 又一次等待收获完成
  return true;
}
```

### 为什么这是错的
1. **如果第一次点击成功** → 已经收获了，不应该再点第二次
2. **如果第一次点击失败** → 应该直接返回 false，而不是再试一次
3. **重复代码** → 维护困难，容易出 bug
4. **可能导致双重收获** → 如果第一次收获刚完成，第二次点击可能触发错误状态

### 修复
移除第二段重复的代码，直接根据 `clickResult` 的值判断：
```javascript
async function harvestIfPossible(page, { expectHarvestable = false } = {}) {
  const beforeSummary = await readFarmSummary(page).catch(() => ({}));

  const clickResult = expectHarvestable
    ? await waitHumanUi('「一键收获」按钮可点击', async () => {
      const result = await clickHarvestButtonOnce(page);
      return result === 'clicked' ? result : null;
    }, { throwOnTimeout: false })
    : await clickHarvestButtonOnce(page);

  // 点击成功
  if (clickResult === 'clicked') {
    log('「一键收获」可点击，先收获。');
    await dismissNotice(page);
    await waitUntil('收获操作完成，页面状态改变', async () => {
      // ... 等待状态变化
    }, 10000);
    return true;
  }

  // 点击失败 - 直接判断原因并返回
  if (clickResult === 'missing') {
    log('没有找到「一键收获」按钮。');
    return false;
  }
  if (clickResult === 'disabled') {
    log('「一键收获」不可点击，跳过收获。');
    return false;
  }

  if (expectHarvestable) {
    log('统计显示有可收获作物，但「一键收获」按钮等待后仍不可点击。');
  }
  return false;
}
```

### 验证的其他方面

#### 1. 检查固定 sleep ✅
```bash
grep -n "await sleep" scripts/farm-bot.js
```
结果：只有合理的 sleep
- `waitUntil` 内部的轮询间隔
- `waitHumanUi` 内部的轮询间隔
- `waitForStableFarmSummary` 的稳定性检查
- 主循环的下一轮等待

#### 2. 检查 TG 通知 ✅
```bash
grep -n "await notify" scripts/farm-bot.js
```
结果：
- ✅ **行 918**: 安全验证/密码需要人工 - 保留
- ✅ **行 1837**: 连续失败 ≥3 次 - 已优化
- ✅ **行 1848**: 本轮完成汇总 - watch 模式
- ✅ **行 1863**: 单次流程完成 - 非 watch 模式

#### 3. 种植流程检查 ✅
- `waitForPlantDialogReady` - 使用配置变量 ✅
- `waitForPlantConfirmReady` - 使用配置变量 ✅
- `waitForPlantSelectionApplied` - 使用配置变量 ✅
- 所有等待都是 10 秒 x 5 次 = 50 秒

#### 4. 收获基准读取 ✅
- `beforeSummary` 在点击前读取 ✅
- 等待状态变化（可收获下降/空闲槽位增加/种植按钮出现）✅

## 总结

### 修复的问题
1. ✅ 移除 `harvestIfPossible()` 中的重复代码
2. ✅ 避免潜在的双重点击收获

### 验证通过
- ✅ 语法检查通过
- ✅ 服务已重启
- ✅ 所有固定 sleep 都合理
- ✅ TG 通知策略正确
- ✅ 种植等待使用配置变量
- ✅ 收获基准在点击前读取

### 教训
**应该在每次修改后主动 review 自己的代码**，而不是等别人指出问题。
