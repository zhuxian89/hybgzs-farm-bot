#!/usr/bin/env node
/**
 * 立即触发售卖（不导航版本）
 * 前提：浏览器已经打开交易所页面 https://cdk.hybgzs.com/entertainment/farm/recycle
 */

import WebSocket from 'ws';

const CDP_ORIGIN = 'http://127.0.0.1:9222';
const FARM_URL = 'https://cdk.hybgzs.com/entertainment/farm';

function log(message) {
  console.log(`[sell-now] ${message}`);
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

async function readTotalSlotsFromFarm(page) {
  // 先记住当前 URL
  const currentUrl = await page.evaluate('window.location.href');

  // 如果不在农场页面，先导航过去
  if (!currentUrl.includes('/farm')) {
    log('导航到农场页面读取地块数...');
    await page.evaluate(`window.location.href = ${JSON.stringify(FARM_URL)}`);
    await sleep(5000);
  }

  for (let attempt = 1; attempt <= 10; attempt++) {
    const bodyText = await page.evaluate('document.body?.innerText || ""');
    const plantedMatch = bodyText.match(/已种植[:：]\s*\d+\s*\/\s*(\d+)/);
    if (plantedMatch) {
      const totalSlots = Number(plantedMatch[1]);
      log(`从农场页面读取到地块数：${totalSlots}`);
      return totalSlots;
    }
    if (attempt < 10) {
      log(`获取地块数失败（第 ${attempt}/10 次），重试...`);
      await sleep(2000);
    }
  }

  throw new Error('连续 10 次无法从农场页面获取地块数');
}

async function main() {
  log('请确保浏览器已打开交易所页面');

  const page = await connectPage();
  log('已连接到浏览器');

  try {
    // 读取地块数
    const keepSeedStock = await readTotalSlotsFromFarm(page);
    log(`立即触发售卖，每种作物保留 ${keepSeedStock} 个（= 地块数）`);

    // 如果之前导航到了农场页面，现在跳转到交易所
    const url = await page.evaluate('window.location.href');
    if (!url.includes('/recycle')) {
      log('跳转到交易所...');
      await page.evaluate(`window.location.href = ${JSON.stringify('https://cdk.hybgzs.com/entertainment/farm/recycle')}`);
      await sleep(5000);
    }

    // 等待页面加载
    log('等待页面加载...');
    for (let i = 0; i < 5; i++) {
      const bodyText = await page.evaluate('document.body?.innerText || ""');
      if (bodyText.includes('快速卖出')) {
        log('页面加载完成');
        break;
      }
      log(`等待中... (${i + 1}/5)`);
      await sleep(2000);
    }

    // 执行售卖逻辑
    const result = await page.evaluate(`(async () => {
      const keepSeedStock = ${keepSeedStock};
      const log = (msg) => console.log('[页面] ' + msg);
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      // 点击快速卖出
      log('点击「快速卖出」...');
      const sellBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.innerText.trim() === '快速卖出'
      );
      if (!sellBtn) return { error: '未找到快速卖出按钮' };
      sellBtn.click();
      await sleep(3000);

      // 等待弹窗加载
      log('等待快速卖出弹窗加载...');
      let dialogReady = false;
      for (let i = 0; i < 5; i++) {
        const bodyText = document.body.innerText;
        if (bodyText.includes('勾选作物并调整数量')) {
          dialogReady = true;
          log('弹窗加载完成');
          break;
        }
        await sleep(1000);
      }

      if (!dialogReady) {
        return { error: '快速卖出弹窗未正常打开' };
      }

      // 读取所有作物
      log('读取作物库存...');
      const normalize = (v) => (v || '').trim().replace(/\\s+/g, ' ');
      const visible = (el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      };

      const rows = Array.from(document.querySelectorAll('div, article, section')).filter(visible);
      const crops = [];

      for (const row of rows) {
        const text = normalize(row.innerText || row.textContent);
        const match = text.match(/^(.+?)\\s+.*?库存\\s*(\\d+)/);
        if (match) {
          crops.push({ name: match[1].trim(), stock: parseInt(match[2], 10) });
        }
      }

      log('找到 ' + crops.length + ' 种作物');

      const needSell = crops.filter(c => c.stock > keepSeedStock);
      if (needSell.length === 0) {
        return { success: true, message: '没有作物需要卖出（所有库存都 <= ' + keepSeedStock + '）' };
      }

      log('需要卖出: ' + needSell.map(c => c.name + '(卖' + (c.stock - keepSeedStock) + '个)').join('、'));

      // 先点击"全选"按钮
      log('点击「全选」按钮...');
      const selectAllBtn = Array.from(document.querySelectorAll('button, [role="button"], input[type="checkbox"]')).find(el => {
        const text = (el.innerText || el.textContent || '').trim();
        return text === '全选';
      });

      if (selectAllBtn) {
        selectAllBtn.click();
        await sleep(1000);
        log('✓ 已点击全选');
      } else {
        log('⚠ 未找到全选按钮，将逐个设置数量');
      }

      // 修改数量
      for (const crop of needSell) {
        const sellQty = crop.stock - keepSeedStock;
        log('设置 ' + crop.name + ' 卖出 ' + sellQty + ' 个...');

        let found = false;
        const allRows = Array.from(document.querySelectorAll('div, article, section')).filter(visible);

        for (const row of allRows) {
          const text = normalize(row.innerText || row.textContent);

          if (text.includes(crop.name) && text.includes('库存')) {
            const inputs = Array.from(row.querySelectorAll('input[type="number"]')).filter(visible);

            if (inputs.length > 0) {
              const input = inputs[0];
              input.value = sellQty;
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
              input.dispatchEvent(new Event('blur', { bubbles: true }));
              input.focus();
              input.blur();
              found = true;
              log('✓ ' + crop.name + ' 已设置');
              break;
            }
          }
        }

        if (!found) {
          log('⚠ 未找到 ' + crop.name + ' 的输入框');
        }

        await sleep(800);
      }

      // 确认卖出
      log('点击「确认卖出」...');

      const allButtons = Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim());
      log('页面上的所有按钮: ' + allButtons.join(', '));

      const statusText = document.body.innerText;
      const selectedMatch = statusText.match(/已选\\s*(\\d+)\\s*种\\s*\\/\\s*(\\d+)\\s*个/);
      if (selectedMatch) {
        log('当前选择状态: 已选 ' + selectedMatch[1] + ' 种 / ' + selectedMatch[2] + ' 个');
      }

      const confirmBtn = Array.from(document.querySelectorAll('button')).find(b =>
        b.innerText.includes('确认卖出') || b.innerText.includes('确认')
      );
      if (!confirmBtn) return { error: '未找到确认卖出按钮。可能是没有成功设置数量，或者按钮文字不匹配。', buttons: allButtons, selected: selectedMatch };
      confirmBtn.click();

      await sleep(2000);
      return { success: true, sold: needSell };
    })()`);

    if (result.error) {
      log(`错误详情: ${result.error}`);
      if (result.buttons) {
        log(`页面按钮: ${result.buttons.join(', ')}`);
      }
      if (result.selected) {
        log(`选择状态: 已选 ${result.selected[1]} 种 / ${result.selected[2]} 个`);
      }
      throw new Error(result.error);
    }

    if (result.success) {
      if (result.sold) {
        log(`✅ 售卖完成！卖出了: ${result.sold.map(c => c.name).join('、')}`);
      } else {
        log(`✅ ${result.message}`);
      }
    }

  } catch (error) {
    log(`❌ 售卖失败: ${error.message}`);
    throw error;
  } finally {
    page.ws.close();
  }
}

main().catch(console.error);
