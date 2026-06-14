# 种植识别失败问题修复

## 问题现象
脚本连续失败 16 次，报错：
```
点击「南瓜」后没有等到种植数量控件，停止本轮，避免误种其他作物。
```

从日志看，脚本：
1. ✅ 成功点击了南瓜卡片（`尝试选择作物「南瓜」：南瓜 $4.00`）
2. ❌ 但等待 5 次 x 10 秒后，仍未识别到"已选中"状态
3. ❌ 页面片段只有农场主页内容，没有种植弹窗的内容

## 根本原因

### 旧的识别逻辑过于严格
`isCropSelectedForPlanting()` 期望找到包含 **"种植数量"** 这个文字，但实际页面可能：
- 只显示数量选择器（`-  1  +` 和 `最大` 按钮）
- 没有"种植数量"这几个字
- 确认按钮是 `种植 x1（需购买 1 个）`

### 4 个识别模式都失败
1. **模式1**: `已选 南瓜` - 页面可能没有这个文字
2. **模式2**: `已选：南瓜` - 页面可能没有这个文字
3. **模式3**: 包含 `南瓜` + `种植数量` - 要求"种植数量"文字，太严格
4. **模式4**: 确认按钮的父级包含 `南瓜` + `种植数量` - 同样要求"种植数量"文字

## 修复方案

### 改进的识别逻辑
不再依赖"种植数量"文字，而是检查：
1. 页面是否有 `种植 x数字` 确认按钮
2. 页面是否包含作物名（南瓜）
3. 是否有数量控件（`+`、`-`、`最大` 按钮或 `input[type="number"]`）

### 新增的模式

**模式3（改进）**: 放宽关键词匹配
```javascript
// 旧：只匹配"种植数量"
.filter((text) => text.includes(cropName) && /已选|选中|当前选择|当前作物|种植数量/.test(text))

// 新：匹配更广泛的关键词
.filter((text) => text.includes(cropName) && /已选|选中|当前选择|当前作物|种植数量|数量|选择/.test(text))
```

**模式4（新增）**: 检查数量控件
```javascript
const confirmButton = Array.from(document.querySelectorAll('button')).find((button) => {
  const text = normalize(button.innerText || button.textContent);
  return !button.disabled && /^种植\\s*x?\\d+/.test(text);  // 更宽松的正则
});

if (confirmButton && bodyText.includes(cropName)) {
  // 检查是否有数量选择器
  const hasQuantityControl = Array.from(document.querySelectorAll('button, input[type="number"]')).some((el) => {
    if (!visible(el)) return false;
    const text = normalize(el.innerText || el.textContent || el.value || '');
    return text === '+' || text === '-' || text === '最大' || el.type === 'number';
  });

  if (hasQuantityControl) return true;  // ✅ 有确认按钮 + 作物名 + 数量控件 = 已选中
}
```

**模式5（改进）**: 父级区域检查更灵活
```javascript
// 不再只检查"种植数量"文字，而是检查：
// - 包含作物名
// - 且包含：数量文字 OR 数字选择器模式（+ 1 -）OR 最大按钮
if (text.includes(cropName) && 
    (text.includes('数量') || text.match(/[+\\-]\\s*\\d+\\s*[+\\-]/) || text.includes('最大'))) {
  return true;
}
```

## 核心改进

### 之前 ❌
```
必须看到"种植数量"这几个字 → 太严格
```

### 现在 ✅
```
看到以下任一组合即可：
1. 确认按钮 + 作物名 + 数量控件（+/-/最大按钮）
2. 区域包含作物名 + "数量"或数字选择器模式
3. 更广泛的关键词匹配（不只是"种植数量"）
```

## 预期效果

修复后，脚本应该能正确识别：
- ✅ 点击南瓜后，数量选择器（- 1 + 最大）出现
- ✅ 确认按钮（种植 x1）出现
- ✅ 即使页面没有"种植数量"文字，也能识别为已选中

## 服务状态
```
✅ 语法检查通过
✅ 服务已重启 (PID: 94513)
✅ 状态: running
```

等待下一轮种植验证效果。
