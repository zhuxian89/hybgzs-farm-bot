#!/usr/bin/env node
/**
 * 测试售卖功能 - 卖出1个指定作物
 * 使用方法: node test-sell.js [作物名]
 * 例如: node test-sell.js 南瓜
 */

import WebSocket from 'ws';

const CDP_ORIGIN = 'http://127.0.0.1:9222';
const RECYCLE_URL = 'https://cdk.hybgzs.com/entertainment/farm/recycle';

function log(message) {
  console.log(`[test-sell] ${message}`);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getTargetInfo() {
  const response = await fetch(`${CDP_ORIGIN}/json`);
  const targets = await response.json();
  const pageTarget = targets.find(t => t.type === 'page');
  if (!pageTarget) throw new Error('没有找到可用的页面标签');
  return pageTarget;
}

class Page {
  constructor(ws) {
    this.ws = ws;
    this.pending = new Map();
    this.nextId = 1;
  }

  async send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout: ${method}`));
      }, 30000);

      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || 'Evaluation failed');
    }
    return result.result?.value;
  }

  async goto(url) {
    await this.send('Page.navigate', { url });
    await sleep(3000);
  }

  async bodyText() {
    return this.evaluate('document.body?.innerText || ""');
  }
}

async function connectPage() {
  const target = await getTargetInfo();
  const ws = new WebSocket(target.webSocketDebuggerUrl);

  return new Promise((resolve, reject) => {
    ws.on('open', async () => {
      const page = new Page(ws);

      ws.on('message', (data) => {
        const message = JSON.parse(data);
        if (!message.id) return;
        const pending = page.pending.get(message.id);
        if (!pending) return;
        page.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result || {});
        }
      });

      await page.send('Runtime.enable');
      await page.send('Page.enable');
      resolve(page);
    });

    ws.on('error', reject);
  });
}

async function clickByText(page, text, { exact = false, buttonOnly = false } = {}) {
  return page.evaluate(`(() => {
    const text = ${JSON.stringify(text)};
    const exact = ${exact};
    const buttonOnly = ${buttonOnly};
    const normalize = (v) => (v || '').trim().replace(/\\s+/g, ' ');
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };

    const selector = buttonOnly ? 'button, [role="button"]' : 'button, [role="button"], a, div, span';
    const elements = Array.from(document.querySelectorAll(selector)).filter(visible);

    const target = elements.find((el) => {
      const value = normalize(el.innerText || el.textContent);
      return exact ? value === text : value.includes(text);
    });

    if (!target) return false;
    target.scrollIntoView({ block: 'center', inline: 'center' });
    target.click();
    return true;
  })()`);
}

async function readQuickSellCropSelection(page, cropName) {
  return page.evaluate(`(() => {
    const cropName = ${JSON.stringify(cropName)};
    const normalize = (v) => (v || '').trim().replace(/\\s+/g, ' ');
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };

    const nodes = Array.from(document.querySelectorAll('body *')).filter(visible);
    for (const el of nodes) {
      const text = normalize(el.innerText || el.textContent);
      const match = text.match(new RegExp(cropName + '\\\\s+已选\\\\s+(\\\\d+)\\\\s*\\\\/\\\\s*库存\\\\s+(\\\\d+)'));
      if (match) {
        return {
          selected: Number(match[1]),
          stock: Number(match[2])
        };
      }
    }
    return null;
  })()`);
}

async function setCropQuantityInQuickSell(page, cropName, quantity) {
  return page.evaluate(`(() => {
    const cropName = ${JSON.stringify(cropName)};
    const quantity = ${JSON.stringify(quantity)};
    const normalize = (value) => (value || '').trim().replace(/\\s+/g, ' ');
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const inputs = Array.from(document.querySelectorAll('input[type="number"]')).filter(visible);

    // 找到最接近的、只包含目标作物的输入框
    let bestMatch = null;
    let shortestText = Infinity;

    for (const input of inputs) {
      let cursor = input;
      for (let depth = 0; cursor && depth < 8; depth += 1) {
        const text = normalize(cursor.innerText || cursor.textContent);

        // 必须包含作物名和库存
        if (text.includes(cropName) && text.includes('库存')) {
          // 检查是否包含其他作物（如果文本很长，可能包含多个作物）
          const match = text.match(/库存\\s*(\\d+)/);
          if (match) {
            const stock = Number(match[1]);
            // 优先选择文本最短的（最接近的父元素，只包含这个作物）
            if (text.length < shortestText) {
              shortestText = text.length;
              bestMatch = { input, stock, text };
            }
          }
        }
        cursor = cursor.parentElement;
      }
    }

    if (!bestMatch) {
      return { selected: false, stock: null, quantity, reason: 'crop-input-not-found' };
    }

    const { input, stock } = bestMatch;

    if (quantity < 0 || quantity > stock) {
      return { selected: false, stock, quantity, reason: 'quantity-out-of-range' };
    }

    input.scrollIntoView({ block: 'center', inline: 'center' });
    input.focus();

    // 清空
    input.value = '';

    // 触发 React 的 setter（关键！）
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeInputValueSetter.call(input, String(quantity));

    // 触发 React 的事件
    const inputEvent = new Event('input', { bubbles: true });
    input.dispatchEvent(inputEvent);

    const changeEvent = new Event('change', { bubbles: true });
    input.dispatchEvent(changeEvent);

    input.blur();

    return { selected: true, stock, quantity };
  })()`);
}

async function main() {
  const cropName = process.argv[2] || '南瓜';
  log(`测试售卖功能：${cropName}，卖出 1 个`);

  const page = await connectPage();
  log('已连接到浏览器');

  try {
    // 1. 进入交易所
    log('进入交易所页面...');
    await page.goto(RECYCLE_URL);

    const bodyText = await page.bodyText();
    if (!bodyText.includes('快速卖出')) {
      throw new Error('交易所页面未正常加载');
    }

    // 2. 点击快速卖出
    log('点击「快速卖出」...');
    const opened = await clickByText(page, '快速卖出', { exact: true, buttonOnly: true });
    if (!opened) {
      throw new Error('未找到「快速卖出」按钮');
    }
    await sleep(2000);

    // 3. 读取库存
    const before = await readQuickSellCropSelection(page, cropName);
    if (!before) {
      throw new Error(`未找到 ${cropName}，库存可能为 0`);
    }
    log(`${cropName} 库存: ${before.stock}，已选: ${before.selected}`);

    if (before.stock === 0) {
      log('库存为 0，无法测试');
      return;
    }

    // 4. 设置卖出 1 个
    log('设置卖出数量为 1...');
    const setResult = await setCropQuantityInQuickSell(page, cropName, 1);
    if (!setResult.selected) {
      throw new Error(`设置数量失败: ${setResult.reason}`);
    }
    log('✓ 设置完成');

    // 5. 等待更新（重要！）
    log('等待页面更新（5秒）...');
    await sleep(5000);

    // 6. 验证
    const after = await readQuickSellCropSelection(page, cropName);
    log(`验证: 库存 ${after.stock}，已选 ${after.selected}`);

    if (after.selected !== 1) {
      throw new Error(`❌ 数量设置未生效！期望 1，实际 ${after.selected}`);
    }

    log('✅ 测试成功！数量设置已生效');
    log('提示：没有执行确认卖出，不会真的卖出');

  } catch (error) {
    log(`❌ 测试失败: ${error.message}`);
    throw error;
  } finally {
    page.ws.close();
  }
}

main().catch(console.error);
