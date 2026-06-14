#!/usr/bin/env node
/**
 * 测试售卖功能
 * 使用方法: node test-sell-simple.js 南瓜
 */

// 简单测试：直接在浏览器控制台执行售卖逻辑

const cropName = process.argv[2] || '南瓜';

console.log(`
====================================
手动测试售卖功能
====================================

作物: ${cropName}

请在浏览器中打开 DevTools 控制台，然后：

1. 打开交易所页面：
   https://farm.linux.do/recycle

2. 在控制台执行以下代码：

async function testSell(cropName) {
  console.log('点击「快速卖出」按钮...');
  const sellButton = Array.from(document.querySelectorAll('button')).find(b =>
    b.innerText.trim() === '快速卖出'
  );
  if (!sellButton) {
    console.error('未找到「快速卖出」按钮');
    return;
  }
  sellButton.click();

  await new Promise(r => setTimeout(r, 2000));

  console.log('查找${cropName}的数量输入框...');
  const rows = Array.from(document.querySelectorAll('div, article, section'));
  for (const row of rows) {
    const text = (row.innerText || '').trim();
    if (text.startsWith(cropName)) {
      console.log('找到${cropName}行:', text);

      const input = row.querySelector('input[type="number"]');
      if (input) {
        const stock = text.match(/库存\\s*(\\d+)/)?.[1];
        console.log('当前库存:', stock);

        // 设置卖出 1 个
        input.value = 1;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        console.log('已设置卖出数量: 1');

        await new Promise(r => setTimeout(r, 1000));

        console.log('点击「确认卖出」按钮...');
        const confirmButton = Array.from(document.querySelectorAll('button')).find(b =>
          b.innerText.includes('确认卖出')
        );
        if (confirmButton) {
          confirmButton.click();
          console.log('✅ 已点击确认卖出');
        } else {
          console.error('未找到「确认卖出」按钮');
        }
        return;
      }
    }
  }
  console.error('未找到${cropName}的输入框');
}

// 执行测试
testSell('${cropName}');

3. 观察是否成功卖出

====================================
`);
