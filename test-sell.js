#!/usr/bin/env node
/**
 * 测试售卖功能
 * 使用方法: node test-sell.js [作物名]
 * 例如: node test-sell.js 南瓜
 */

import CDP from 'chrome-remote-interface';

const CDP_ORIGIN = 'http://127.0.0.1:9222';
const RECYCLE_URL = 'https://farm.linux.do/recycle';

// 从 farm-bot.js 复制的必要函数
async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function log(message) {
  console.log(`[test-sell] ${message}`);
}

class Page {
  constructor(client) {
    this.client = client;
    this.ws = null;
    this.pending = new Map();
    this.nextId = 1;
  }

  async connect() {
    const { webSocketDebuggerUrl } = await this.client;
    const WebSocket = (await import('ws')).default;
    this.ws = new WebSocket(webSocketDebuggerUrl);

    this.ws.on('message', (data) => {
      const message = JSON.parse(data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      } else {
        pending.resolve(message.result || {});
      }
    });

    await new Promise((resolve, reject) => {
      this.ws.once('open', resolve);
      this.ws.once('error', reject);
    });

    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }

  async send(method, params = {}) {
    const id = this.nextId++;
    const message = { id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timeout: ${method}`));
      }, 15000);

      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(message));
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

  async bodyText() {
    return this.evaluate('document.body?.innerText || ""');
  }

  async goto(url) {
    await this.send('Page.navigate', { url });
    await sleep(2000);
  }

  async close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

async function clickByText(page, text, { exact = false, buttonOnly = false } = {}) {
  return page.evaluate(`(() => {
    const text = ${JSON.stringify(text)};
    const exact = ${exact};
    const buttonOnly = ${buttonOnly};
    const normalize = (value) => (value || '').trim().replace(/\\s+/g, ' ');
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

async function enterRecyclePage(page) {
  await page.goto(RECYCLE_URL);
  log('等待交易所页面加载...');
  await sleep(3000);
}

async function openQuickSellDialog(page) {
  log('点击「快速卖出」按钮...');
  const opened = await clickByText(page, '快速卖出', { exact: true, buttonOnly: true });
  if (!opened) {
    throw new Error('没有找到可点击的「快速卖出」按钮');
  }
  await sleep(2000);

  const bodyText = await page.bodyText();
  if (!bodyText.includes('勾选作物并调整数量')) {
    throw new Error('快速卖出弹窗未正常打开');
  }

  log('快速卖出弹窗已打开');
}

async function readQuickSellCropSelection(page, cropName) {
  return page.evaluate(`(() => {
    const cropName = ${JSON.stringify(cropName)};
    const normalize = (value) => (value || '').trim().replace(/\\s+/g, ' ');
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };

    const rows = Array.from(document.querySelectorAll('div, article, section')).filter(visible);
    for (const row of rows) {
      const text = normalize(row.innerText || row.textContent);
      if (!text.startsWith(cropName)) continue;

      const match = text.match(/库存\\s*(\\d+).*?已选\\s*(\\d+)/);
      if (match) {
        return {
          stock: parseInt(match[1], 10),
          selected: parseInt(match[2], 10)
        };
      }
    }
    return null;
  })()`);
}

async function setCropQuantityInQuickSell(page, cropName, quantity) {
  log(`设置${cropName}卖出数量为 ${quantity}...`);

  const result = await page.evaluate(`(() => {
    const cropName = ${JSON.stringify(cropName)};
    const quantity = ${quantity};
    const normalize = (value) => (value || '').trim().replace(/\\s+/g, ' ');
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };

    const rows = Array.from(document.querySelectorAll('div, article, section')).filter(visible);
    for (const row of rows) {
      const text = normalize(row.innerText || row.textContent);
      if (!text.startsWith(cropName)) continue;

      const inputs = Array.from(row.querySelectorAll('input[type="number"]')).filter(visible);
      if (inputs.length) {
        inputs[0].value = quantity;
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        inputs[0].dispatchEvent(new Event('change', { bubbles: true }));
        return { selected: true };
      }
    }

    return { selected: false };
  })()`);

  if (!result.selected) {
    throw new Error(`未找到${cropName}的数量输入框`);
  }

  await sleep(1000);
}

async function confirmQuickSell(page) {
  log('点击「确认卖出」按钮...');
  const clicked = await clickByText(page, '确认卖出', { exact: false, buttonOnly: true });
  if (!clicked) {
    throw new Error('没有找到「确认卖出」按钮');
  }
  await sleep(2000);
}

async function testSell(cropName) {
  log(`开始测试售卖功能，作物: ${cropName}`);

  const client = await CDP({ port: 9222 });
  const page = new Page(client);

  try {
    await page.connect();
    log('已连接到 Chrome');

    // 1. 进入交易所
    await enterRecyclePage(page);

    // 2. 打开快速卖出弹窗
    await openQuickSellDialog(page);

    // 3. 读取当前库存
    const before = await readQuickSellCropSelection(page, cropName);
    if (!before) {
      throw new Error(`未找到${cropName}，可能库存为 0 或作物名不正确`);
    }

    log(`${cropName} 当前库存: ${before.stock} 个`);

    if (before.stock === 0) {
      log('库存为 0，无法测试售卖');
      return;
    }

    // 4. 设置卖出数量（卖出 1 个用于测试）
    const sellQuantity = 1;
    await setCropQuantityInQuickSell(page, cropName, sellQuantity);

    // 5. 验证设置是否生效
    await sleep(1000);
    const after = await readQuickSellCropSelection(page, cropName);
    log(`设置后: 库存 ${after.stock}，已选 ${after.selected}`);

    if (after.selected !== sellQuantity) {
      throw new Error(`数量设置失败，期望 ${sellQuantity}，实际 ${after.selected}`);
    }

    // 6. 确认卖出
    await confirmQuickSell(page);

    log('✅ 售卖测试成功！');

  } catch (error) {
    log(`❌ 售卖测试失败: ${error.message}`);
    throw error;
  } finally {
    await page.close();
  }
}

// 主函数
const cropName = process.argv[2] || '南瓜';
testSell(cropName).catch((error) => {
  console.error(error);
  process.exit(1);
});
