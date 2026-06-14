import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { launchDedicatedChrome } from './chrome-launcher.js';
import { farmConfig, projectRoot } from './farm-config.js';

const HOME_URL = 'https://cdk.hybgzs.com/';
const FARM_URL = 'https://cdk.hybgzs.com/entertainment/farm';
const RECYCLE_URL = 'https://cdk.hybgzs.com/entertainment/farm/recycle';
const DATA_DIR = path.join(projectRoot, 'data');
const FARM_CROPS_FILE = path.join(projectRoot, 'data', 'farm-crops.json');
const FARM_STATE_FILE = path.join(projectRoot, 'data', 'farm-state.json');
const AUTH_URL_PATTERN = /\/login|linux\.do|accounts\.google\.com|oauth2/i;
const SECURITY_TEXT_PATTERN = /安全验证|Cloudflare|Just a moment|Checking your browser|请稍候|正在检查/i;
const SPEND_CONFIRM_PATTERN = /花费|消耗|支付|扣除|购买|买入|余额|金币|积分|确定购买|确认购买|是否购买|是否消耗|是否花费/i;
const AUTO_PLANT_CROP = 'auto';
const FALLBACK_PLANT_CROP = '番茄';
const CHROME_DEBUG_PORT = String(farmConfig.chrome.debugPort);
const CDP_ORIGIN = farmConfig.chrome.cdpOrigin || `http://127.0.0.1:${CHROME_DEBUG_PORT}`;

const stepTimeoutMs = Number(farmConfig.timing.stepTimeoutMs);
const manualTimeoutMs = Number(farmConfig.timing.manualTimeoutMs);
const cdpCommandTimeoutMs = Number(farmConfig.timing.cdpCommandTimeoutMs);
const watchMode = process.argv.includes('--watch');
const testSellCropName = getArgValue('--test-sell');
const testSellQuantity = parsePositiveIntegerArg('--quantity');
const intervalMinutes = Number(farmConfig.timing.intervalMinutes);
const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
const matureBufferSeconds = Number(farmConfig.timing.matureBufferSeconds);
const actionRetryMinutes = Number(farmConfig.timing.actionRetryMinutes);
const actionRetryMs = Math.max(1, actionRetryMinutes) * 60 * 1000;
const failureRetrySeconds = Number(farmConfig.timing.failureRetrySeconds);
const failureRetryMs = Math.max(1, failureRetrySeconds) * 1000;
const plantRetryAttempts = Math.max(1, Number(farmConfig.retries.plantAttempts));
const sellRetryAttempts = Math.max(1, Number(farmConfig.retries.sellAttempts));
const uiWaitAttempts = Math.max(1, Number(farmConfig.timing.uiWaitAttempts));
const uiWaitIntervalMs = Math.max(1, Number(farmConfig.timing.uiWaitSeconds)) * 1000;
const configuredPlantCrop = String(farmConfig.strategy.plantCrop || AUTO_PLANT_CROP).trim();
const maxSeedPrice = Number(farmConfig.strategy.maxSeedPrice);
const strategyRecalcRounds = Math.max(1, Number(farmConfig.strategy.recalcAfterSuccessfulPlantRounds));
const keepSeedStock = Math.max(0, Number(farmConfig.strategy.keepSeedStock));
const farmCrops = loadFarmCrops(FARM_CROPS_FILE);
const cropNamePatternSource = farmCrops.map((crop) => escapeRegExp(crop.name)).join('|');

function loadFarmCrops(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const data = JSON.parse(content);
  if (!Array.isArray(data.crops)) {
    throw new Error(`图鉴数据格式错误：${filePath}`);
  }
  return data.crops;
}

function getCropInfo(cropName) {
  return farmCrops.find((crop) => crop.name === cropName) || null;
}

function getAllowedPlantCrops() {
  return farmCrops.filter((crop) => crop.type === 'normal' && crop.seedPrice <= maxSeedPrice);
}

function createDefaultFarmState(selectedCrop = STATIC_PLANT_CROP_NAME) {
  return {
    selectedCrop,
    recommendedCrop: selectedCrop,
    plantedRoundsSinceRecalc: 0,
    lastStrategyAt: null,
    lastExchangePrices: {},
    lastProfitRanking: []
  };
}

function loadFarmState() {
  const defaultState = createDefaultFarmState(STATIC_PLANT_CROP_NAME);
  if (!fs.existsSync(FARM_STATE_FILE)) return defaultState;

  try {
    return { ...defaultState, ...JSON.parse(fs.readFileSync(FARM_STATE_FILE, 'utf8')) };
  } catch (error) {
    log(`读取本地状态失败，将重建：${error.message}`);
    return defaultState;
  }
}

function saveFarmState(state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FARM_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function rankCropsByProfit(crops, exchangePrices) {
  return crops
    .map((crop) => {
      const sellPrice = exchangePrices[crop.name];
      if (!Number.isFinite(sellPrice)) return null;
      const revenue = crop.yield * sellPrice;
      const profit = revenue - crop.seedPrice;
      const profitPerHour = profit / crop.growHours;
      const roundsPerDay = 24 / crop.growHours;
      const dailyProfit = profit * roundsPerDay;
      return {
        ...crop,
        sellPrice,
        costPrice: crop.seedPrice,
        revenue,
        profit,
        profitPerHour,
        roundsPerDay,
        dailyProfit
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.dailyProfit - a.dailyProfit);
}

function getStaticPlantCropName() {
  if (configuredPlantCrop.toLowerCase() !== 'auto') {
    const crop = getCropInfo(configuredPlantCrop);
    if (!crop) {
      throw new Error(`配置的种植作物不存在于本地图鉴：${configuredPlantCrop}`);
    }
    if (crop.type !== 'normal') {
      throw new Error(`当前只允许种植普通作物：${configuredPlantCrop}`);
    }
    if (crop.seedPrice > maxSeedPrice) {
      throw new Error(`配置的种植作物种子价格 ${crop.seedPrice} 超过当前上限 ${maxSeedPrice}：${configuredPlantCrop}`);
    }
    return crop.name;
  }

  const fallback = getCropInfo(FALLBACK_PLANT_CROP);
  if (!fallback) {
    throw new Error(`默认种植作物不存在于本地图鉴：${FALLBACK_PLANT_CROP}`);
  }
  return fallback.name;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const STATIC_PLANT_CROP_NAME = getStaticPlantCropName();
const farmState = loadFarmState();

function getCropNamePattern() {
  return new RegExp(`\\n(${cropNamePatternSource})\\n`, 'g');
}

function isAutoPlantMode() {
  return configuredPlantCrop.toLowerCase() === AUTO_PLANT_CROP;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function serializeRanking(ranking) {
  return ranking.slice(0, 8).map((item) => ({
    name: item.name,
    seedPrice: item.seedPrice,
    sellPrice: roundMoney(item.sellPrice),
    yield: item.yield,
    growHours: item.growHours,
    profit: roundMoney(item.profit),
    profitPerHour: roundMoney(item.profitPerHour),
    roundsPerDay: roundMoney(item.roundsPerDay),
    dailyProfit: roundMoney(item.dailyProfit)
  }));
}

function getArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

function parsePositiveIntegerArg(name) {
  const value = getArgValue(name);
  if (!value) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${name} 必须是正整数，实际：${value}`);
  }
  return number;
}

function rankingNames(ranking) {
  return ranking.map((item) => item.name);
}

function getPersistedCropName() {
  const name = farmState.selectedCrop || STATIC_PLANT_CROP_NAME;
  const crop = getCropInfo(name);
  if (crop && crop.type === 'normal' && crop.seedPrice <= maxSeedPrice) return crop.name;
  return STATIC_PLANT_CROP_NAME;
}

function describeStrategy(strategy) {
  if (!strategy) return '策略：未计算';
  const lines = [`策略：${strategy.mode === 'auto' ? '自动选择' : '固定作物'}，当前目标 ${strategy.selectedCrop}`];
  if (strategy.recalculated && strategy.ranking?.length) {
    const top = strategy.ranking.slice(0, 3)
      .map((item) => `${item.name} ${roundMoney(item.dailyProfit || 0)}/天`)
      .join('，');
    lines.push(`收益前三：${top}`);
  }
  lines.push(`重算进度：${farmState.plantedRoundsSinceRecalc}/${strategyRecalcRounds}`);
  return lines.join('\n');
}

function log(message) {
  console.log(`[farm-bot] ${message}`);
}

async function notify(message) {
  const token = process.env.TG_BOT_TOKEN;
  const chatId = process.env.TG_CHAT_ID;
  if (!token || !chatId) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        chat_id: chatId,
        text: `[farm-bot]\n${message}`
      })
    });

    if (!response.ok) {
      log(`Telegram 通知失败：HTTP ${response.status}`);
    }
  } catch (error) {
    log(`Telegram 通知失败：${error.message}`);
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(description, predicate, timeout = stepTimeoutMs, interval = 500) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeout) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(interval);
  }

  throw new Error(`等待超时：${description}${lastError ? `。最后错误：${lastError.message}` : ''}`);
}

async function waitHumanUi(description, predicate, { attempts = uiWaitAttempts, interval = uiWaitIntervalMs, throwOnTimeout = true } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await predicate(attempt);
      if (result !== false && result !== null && result !== undefined) return result;
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts) {
      log(`${description} 未就绪，${formatDuration(interval)}后再检查（${attempt}/${attempts}）。`);
      await sleep(interval);
    }
  }

  if (throwOnTimeout) {
    throw new Error(`等待超时：${description}，已按 ${formatDuration(interval)} 间隔检查 ${attempts} 次${lastError ? `。最后错误：${lastError.message}` : ''}`);
  }

  return null;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${url} returned ${response.status}`);
    }
    return response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`${url} 请求超时`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForCdp() {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < 15000) {
    try {
      await fetchJson(`${CDP_ORIGIN}/json/version`);
      return;
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }

  throw new Error(`无法连接专用 Chrome，端口 ${CHROME_DEBUG_PORT} 未就绪：${lastError?.message || 'unknown'}`);
}

async function ensureDedicatedChrome() {
  try {
    await fetchJson(`${CDP_ORIGIN}/json/version`);
    return;
  } catch {
    log('专用 Chrome 未启动，自动启动。');
    const info = launchDedicatedChrome({ port: CHROME_DEBUG_PORT });
    log(`已启动专用 Chrome：${info.chromePath}`);
    log(`Profile：${info.chromeProfileDir}`);
  }

  await waitForCdp();
}

class CdpPage {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.allowedSpendConfirm = null;
    this.unusable = false;
  }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.on('close', () => {
      this.rejectAllPending(new Error('CDP WebSocket 已关闭'));
    });
    this.ws.on('error', (error) => {
      this.rejectAllPending(new Error(`CDP WebSocket 错误：${error.message}`));
    });
    this.ws.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.method === 'Page.javascriptDialogOpening') {
        const dialogMessage = message.params?.message || '';
        const maySpend = SPEND_CONFIRM_PATTERN.test(dialogMessage);
        if (maySpend) {
          if (this.isSpendConfirmAllowed(dialogMessage)) {
            log(`允许${this.allowedSpendConfirm.reason}弹窗：${dialogMessage}`);
            this.clearSpendConfirm();
            this.send('Page.handleJavaScriptDialog', { accept: true }).catch((error) => {
              log(`确认弹窗失败：${error.message}`);
            });
            return;
          }

          log(`拒绝花钱/消耗类弹窗：${dialogMessage}`);
          this.send('Page.handleJavaScriptDialog', { accept: false }).catch((error) => {
            log(`拒绝弹窗失败：${error.message}`);
          });
          notify(`已拒绝疑似花钱/消耗确认弹窗。\n弹窗内容：${dialogMessage}`).catch(() => {});
          return;
        }

        log(`自动确认弹窗：${dialogMessage}`);
        this.send('Page.handleJavaScriptDialog', { accept: true }).catch((error) => {
          log(`确认弹窗失败：${error.message}`);
        });
        return;
      }
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

    await this.send('Page.enable');
    await this.send('Runtime.enable');
    await this.send('DOM.enable');
  }

  send(method, params = {}) {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP WebSocket 未连接，无法执行 ${method}`));
    }

    const id = this.nextId++;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.unusable = true;
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.close();
        }
        reject(new Error(`CDP 命令超时：${method} 等待 ${Math.round(cdpCommandTimeoutMs / 1000)} 秒无响应`));
      }, cdpCommandTimeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(payload, (error) => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (pending) clearTimeout(pending.timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  rejectAllPending(error) {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  allowSpendConfirm(reason, ttlMs = 15000) {
    this.allowedSpendConfirm = {
      reason,
      expiresAt: Date.now() + ttlMs
    };
  }

  clearSpendConfirm() {
    this.allowedSpendConfirm = null;
  }

  isSpendConfirmAllowed(message) {
    if (!this.allowedSpendConfirm) return false;
    if (Date.now() > this.allowedSpendConfirm.expiresAt) {
      this.clearSpendConfirm();
      return false;
    }
    return true;
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Runtime.evaluate failed');
    }
    return result.result?.value;
  }

  async goto(url) {
    await this.send('Page.navigate', { url });
    // 注意：这里只等待 DOM readyState，不等待 SPA 业务内容渲染
    // 调用者必须额外调用业务页面的 ready 检查函数：
    // - FARM_URL → waitForFarmReady()
    // - RECYCLE_URL → waitForRecycleReady()
    // - 登录流程 → ensureDashboardOrFarmPage()
    await waitUntil('DOM 基础加载完成', async () => {
      const currentUrl = await this.evaluate('location.href').catch(() => '');
      const readyState = await this.evaluate('document.readyState').catch(() => '');
      return currentUrl && (readyState === 'complete' || readyState === 'interactive');
    }, 15000);
  }

  async url() {
    return this.evaluate('location.href');
  }

  async title() {
    return this.evaluate('document.title');
  }

  async bodyText() {
    return this.evaluate('document.body ? document.body.innerText : ""');
  }

  async close() {
    this.rejectAllPending(new Error('CDP 页面连接已主动关闭'));
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }
}

async function newPage(url = HOME_URL) {
  await ensureDedicatedChrome();
  const tab = await fetchJson(`${CDP_ORIGIN}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
  const page = new CdpPage(tab.webSocketDebuggerUrl);
  await page.connect();
  return page;
}

async function getOrCreatePage({ fresh = false } = {}) {
  await ensureDedicatedChrome();

  if (fresh) {
    return newPage(HOME_URL);
  }

  let tabs = await fetchJson(`${CDP_ORIGIN}/json/list`);
  let tab = tabs.find((item) => item.type === 'page' && (item.url || '').startsWith('https://cdk.hybgzs.com/'))
    || tabs.find((item) => item.type === 'page' && (item.url || '') === 'about:blank');

  if (!tab) {
    tab = await fetchJson(`${CDP_ORIGIN}/json/new?${encodeURIComponent(HOME_URL)}`, { method: 'PUT' });
  }

  const page = new CdpPage(tab.webSocketDebuggerUrl);
  await page.connect();
  return page;
}

async function dismissNotice(page) {
  const clicked = await clickByText(page, '我知道了', { exact: true });
  if (clicked) {
    log('点击公告「我知道了」。');
    try {
      await waitUntil('公告弹窗关闭', async () => {
        const hasButton = await page.evaluate(`(() => {
          const buttons = Array.from(document.querySelectorAll('button, [role="button"], a'));
          return buttons.some((el) => {
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            const visible = style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
            const text = (el.innerText || el.textContent || '').trim();
            return visible && text === '我知道了';
          });
        })()`);
        return !hasButton;
      }, 5000);
    } catch (error) {
      log(`等待公告弹窗关闭超时，继续执行：${error.message}`);
    }
  }
}

async function clickByText(page, text, { exact = false, buttonOnly = false } = {}) {
  const source = JSON.stringify({ text, exact, buttonOnly });
  return page.evaluate(`(() => {
    const { text, exact, buttonOnly } = ${source};
    const tags = buttonOnly ? ['button', 'a', '[role="button"]'] : ['button', 'a', '[role="button"]', 'h1', 'h2', 'h3', 'div', 'span'];
    const nodes = tags.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const matches = nodes.filter((el) => {
      if (buttonOnly && el.disabled) return false;
      if (!visible(el)) return false;
      const value = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ');
      return exact ? value === text : value.includes(text);
    });
    if (matches.length < 1) return false;
    matches[0].scrollIntoView({ block: 'center', inline: 'center' });
    matches[0].click();
    return true;
  })()`);
}

async function clickFirstPlantButton(page) {
  return page.evaluate(`(() => {
    const buttons = Array.from(document.querySelectorAll('button')).filter((button) => {
      const text = (button.innerText || button.textContent || '').trim();
      return text === '种植' && !button.disabled;
    });
    if (!buttons.length) return false;
    buttons[0].scrollIntoView({ block: 'center', inline: 'center' });
    buttons[0].click();
    return true;
  })()`);
}

async function clickEnabledButtonContaining(page, text) {
  return page.evaluate(`(() => {
    const text = ${JSON.stringify(text)};
    const buttons = Array.from(document.querySelectorAll('button')).filter((button) => {
      const value = (button.innerText || button.textContent || '').trim().replace(/\\s+/g, ' ');
      return !button.disabled && value.includes(text);
    });
    if (!buttons.length) return false;
    buttons[0].scrollIntoView({ block: 'center', inline: 'center' });
    buttons[0].click();
    return true;
  })()`);
}

async function clickEnabledButtonExact(page, text) {
  return page.evaluate(`(() => {
    const text = ${JSON.stringify(text)};
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], a')).filter((button) => {
      const value = (button.innerText || button.textContent || '').trim().replace(/\\s+/g, ' ');
      return visible(button) && !button.disabled && value === text;
    });
    if (!buttons.length) return false;
    buttons[0].scrollIntoView({ block: 'center', inline: 'center' });
    buttons[0].click();
    return true;
  })()`);
}

async function clickPlantMaxButton(page) {
  return page.evaluate(`(() => {
    const normalize = (value) => (value || '').trim().replace(/\\s+/g, ' ');
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const candidates = Array.from(document.querySelectorAll('button, [role="button"], a, div, span'))
      .filter(visible)
      .map((el) => ({ el, text: normalize(el.innerText || el.textContent) }))
      .filter(({ el, text }) => !el.disabled && (text === '最大' || /^最大\\b/.test(text)))
      .sort((a, b) => a.text.length - b.text.length);
    if (!candidates.length) return false;
    candidates[0].el.scrollIntoView({ block: 'center', inline: 'center' });
    candidates[0].el.click();
    return true;
  })()`);
}

async function setPlantQuantityFallback(page, quantity) {
  return page.evaluate(`(() => {
    const quantity = ${JSON.stringify(quantity)};
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const input = Array.from(document.querySelectorAll('input[type="number"], input:not([type])'))
      .filter(visible)
      .find((candidate) => !candidate.disabled);
    if (!input || !(quantity > 0)) return false;
    input.scrollIntoView({ block: 'center', inline: 'center' });
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (setter) setter.call(input, String(quantity));
    else input.value = String(quantity);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
}

async function readPlantDialogState(page, cropNames = []) {
  return page.evaluate(`(() => {
    const cropNames = ${JSON.stringify(cropNames)};
    const normalize = (value) => (value || '').trim().replace(/\\s+/g, ' ');
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const bodyText = normalize(document.body?.innerText || '');
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], a, div, span'))
      .filter(visible)
      .map((el) => normalize(el.innerText || el.textContent))
      .filter(Boolean);
    const hasMax = buttons.some((text) => text === '最大' || /^最大\\b/.test(text));
    const confirmLabel = buttons.find((text) => /^种植\\s*x\\d+/.test(text)) || null;
    const cropCards = Array.from(document.querySelectorAll('button, [role="button"], article, section, div'))
      .filter(visible)
      .map((el) => normalize(el.innerText || el.textContent))
      .filter(Boolean);
    const candidateCrops = cropNames.filter((cropName) => cropCards.some((text) => {
      if (!text.startsWith(cropName)) return false;
      if (cropNames.some((other) => other !== cropName && text.includes(other))) return false;
      return true;
    }));
    return {
      hasDialog: /种植数量|选择作物|库存|最大/.test(bodyText),
      hasMax,
      confirmLabel,
      candidateCrops,
      bodySnippet: bodyText.slice(0, 300)
    };
  })()`);
}

async function waitForPlantDialogReady(page, cropNames) {
  return waitHumanUi('种植选择界面加载完成', async () => {
    await dismissNotice(page);
    const state = await readPlantDialogState(page, cropNames);
    return state.hasDialog && state.candidateCrops.length ? state : null;
  }, { attempts: uiWaitAttempts, interval: uiWaitIntervalMs, throwOnTimeout: false });
}

async function waitForPlantConfirmReady(page) {
  return waitHumanUi('种植确认按钮出现', async () => {
    await dismissNotice(page);
    const state = await readPlantDialogState(page);
    return state.confirmLabel ? state.confirmLabel : null;
  }, { attempts: uiWaitAttempts, interval: uiWaitIntervalMs, throwOnTimeout: false });
}

async function clickPlantConfirm(page) {
  return page.evaluate(`(() => {
    const buttons = Array.from(document.querySelectorAll('button')).filter((button) => {
      const value = (button.innerText || button.textContent || '').trim().replace(/\\s+/g, ' ');
      return !button.disabled && /^种植\\s*x\\d+/.test(value);
    });
    if (!buttons.length) return null;
    const label = (buttons[0].innerText || buttons[0].textContent || '').trim().replace(/\\s+/g, ' ');
    buttons[0].scrollIntoView({ block: 'center', inline: 'center' });
    buttons[0].click();
    return label;
  })()`);
}

async function isCropSelectedForPlanting(page, cropName) {
  return page.evaluate(`(() => {
    const cropName = ${JSON.stringify(cropName)};
    const normalize = (value) => (value || '').trim().replace(/\\s+/g, ' ');
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const bodyText = normalize(document.body?.innerText || '');

    // 模式1: "已选 作物名"
    if (new RegExp('已选\\\\s*' + cropName).test(bodyText)) return true;

    // 模式2: "已选：作物名"
    if (new RegExp('已选[:：]\\\\s*' + cropName).test(bodyText)) return true;

    // 模式3: 找到包含"作物名 + 种植数量/数量/选择数量"的区域
    const nodes = Array.from(document.querySelectorAll('body *')).filter(visible);
    const selectedNode = nodes
      .map((el) => normalize(el.innerText || el.textContent))
      .filter((text) => text.includes(cropName) && /已选|选中|当前选择|当前作物|种植数量|数量|选择/.test(text))
      .sort((a, b) => a.length - b.length)[0];
    if (selectedNode && selectedNode.length <= 260) return true;

    // 模式4: 确认按钮（"种植 x数字"）存在，且页面包含作物名
    const confirmButton = Array.from(document.querySelectorAll('button')).find((button) => {
      const text = normalize(button.innerText || button.textContent);
      return !button.disabled && /^种植\\s*x?\\d+/.test(text);
    });

    if (confirmButton && bodyText.includes(cropName)) {
      // 检查是否有数量选择器（+ - 按钮或输入框）
      const hasQuantityControl = Array.from(document.querySelectorAll('button, input[type="number"]')).some((el) => {
        if (!visible(el)) return false;
        const text = normalize(el.innerText || el.textContent || el.value || '');
        return text === '+' || text === '-' || text === '最大' || el.type === 'number';
      });

      if (hasQuantityControl) return true;
    }

    // 模式5: 确认按钮的父级区域包含作物名和数量控件
    if (confirmButton) {
      let cursor = confirmButton;
      for (let depth = 0; cursor && depth < 6; depth += 1) {
        const text = normalize(cursor.innerText || cursor.textContent);
        if (text.includes(cropName) && (text.includes('数量') || text.match(/[+\\-]\\s*\\d+\\s*[+\\-]/) || text.includes('最大'))) {
          return true;
        }
        cursor = cursor.parentElement;
      }
    }

    return false;
  })()`);
}

async function getPageState(page) {
  const [title, url, bodyText] = await Promise.all([
    page.title().catch(() => ''),
    page.url().catch(() => ''),
    page.bodyText().catch(() => '')
  ]);

  if (SECURITY_TEXT_PATTERN.test(title) || SECURITY_TEXT_PATTERN.test(bodyText)) {
    return { type: 'security', title, url, bodyText };
  }
  if (/accounts\.google\.com/i.test(url) && /password|challenge|signin\/v2\/challenge|pwd/i.test(url + bodyText)) {
    return { type: 'google-password', title, url, bodyText };
  }
  if (/accounts\.google\.com/i.test(url) && /密码|输入您的密码|password|challenge|signin\/v2\/challenge|pwd/i.test(url + bodyText)) {
    return { type: 'google-password', title, url, bodyText };
  }
  if (/accounts\.google\.com/i.test(url) && /允许|继续|Continue|Allow/i.test(bodyText)) {
    return { type: 'google-consent', title, url, bodyText };
  }
  if (/linux\.do\/login/i.test(url) || bodyText.includes('使用 Google 登录')) {
    return { type: 'linuxdo-login', title, url, bodyText };
  }
  if (url.startsWith(FARM_URL) && (bodyText.includes('轻松农场') || bodyText.includes('我的农田'))) {
    return { type: 'farm', title, url, bodyText };
  }
  if (bodyText.includes('轻松农场') && bodyText.includes('我的农田')) {
    return { type: 'farm', title, url, bodyText };
  }
  if (!AUTH_URL_PATTERN.test(url) && bodyText.includes('进入农场')) {
    return { type: 'dashboard', title, url, bodyText };
  }
  if (!AUTH_URL_PATTERN.test(url) && bodyText.includes('LinuxDo 登录')) {
    return { type: 'home-login', title, url, bodyText };
  }
  if (AUTH_URL_PATTERN.test(url)) {
    return { type: 'auth', title, url, bodyText };
  }
  return { type: 'unknown', title, url, bodyText };
}

async function waitForManualRequired(page, expectedType) {
  const label = expectedType === 'security' ? 'Cloudflare 安全验证' : 'Google 密码输入';
  await waitUntil(`${label} 手动完成后 dashboard 或农场页面加载完成`, async () => {
    await dismissNotice(page);
    const state = await getPageState(page);
    return state.type === 'dashboard' || state.type === 'farm';
  }, manualTimeoutMs);
}

async function clickAnyText(page, texts, options) {
  for (const text of texts) {
    if (await clickByText(page, text, options)) return text;
  }
  return null;
}

async function advanceLoginFlow(page, state) {
  if (state.type === 'home-login') {
    const clicked = await clickAnyText(page, ['LinuxDo 登录'], { exact: true, buttonOnly: true });
    if (!clicked) throw new Error('首页需要登录，但没有找到「LinuxDo 登录」按钮。');
    log('点击「LinuxDo 登录」。');
    await waitUntil('点击「LinuxDo 登录」后页面跳转', async () => {
      const newState = await getPageState(page);
      return newState.type !== 'home-login';
    }, 10000);
    return true;
  }

  if (state.type === 'linuxdo-login') {
    const clicked = await clickAnyText(page, ['使用 Google 登录', 'Google'], { exact: false, buttonOnly: true });
    if (!clicked) throw new Error('LinuxDo 登录页没有找到 Google 登录入口。');
    log('点击「使用 Google 登录」。');
    await waitUntil('点击「使用 Google 登录」后页面跳转', async () => {
      const newState = await getPageState(page);
      return newState.type !== 'linuxdo-login';
    }, 10000);
    return true;
  }

  if (state.type === 'google-consent') {
    const clicked = await clickAnyText(page, ['允许', '继续', 'Allow', 'Continue'], { exact: false, buttonOnly: true });
    if (!clicked) throw new Error('Google 授权页没有找到可点击的继续/允许按钮。');
    log(`点击 Google「${clicked}」。`);
    await waitUntil('点击授权按钮后页面跳转', async () => {
      const newState = await getPageState(page);
      return newState.type !== 'google-consent';
    }, 15000);
    return true;
  }

  return false;
}

async function isDashboardReady(page) {
  return (await getPageState(page)).type === 'dashboard';
}

async function isFarmReady(page) {
  return (await getPageState(page)).type === 'farm';
}

async function clickFarmEntry(page) {
  if ((await page.url()).startsWith(FARM_URL) || await isFarmReady(page)) {
    return;
  }

  await waitForDashboardReady(page);
  await waitHumanUi('dashboard 出现可点击的「进入农场」入口', async () => {
    await dismissNotice(page);
    return await clickByText(page, '进入农场', { exact: true, buttonOnly: true });
  });

  log('点击「进入农场」。');
  await dismissNotice(page);
  await waitHumanUi('点击「进入农场」后进入农场页面', async () => {
    await dismissNotice(page);
    return await isFarmReady(page);
  });
}

async function waitForDashboardReady(page) {
  await waitHumanUi('dashboard 加载出「进入农场」入口', async () => {
    await dismissNotice(page);
    if (await isFarmReady(page)) {
      return true;
    }
    return await isDashboardReady(page);
  });
}

async function waitForFarmReady(page) {
  await waitHumanUi('农场页面加载完成', async () => {
    await dismissNotice(page);
    if (await isFarmReady(page)) return true;
    if (await isDashboardReady(page)) {
      await clickFarmEntry(page);
      return await isFarmReady(page);
    }
    return false;
  });
  await waitHumanUi('农场统计卡片渲染完成', async () => {
    await dismissNotice(page);
    const summary = await readFarmSummary(page);
    return summaryReady(summary) ? summary : null;
  });
}

async function ensureDashboardOrFarmPage(page) {
  log('打开主页。');
  await page.goto(HOME_URL);
  await dismissNotice(page);

  await waitUntil('主页加载或进入登录/安全验证状态', async () => {
    const state = await getPageState(page);
    return ['security', 'google-password', 'home-login', 'linuxdo-login', 'google-consent', 'auth', 'dashboard', 'farm'].includes(state.type);
  }, 30000);

  let state = await getPageState(page);
  for (let attempt = 0; attempt < 6 && state.type !== 'dashboard' && state.type !== 'farm'; attempt += 1) {
    if (state.type === 'security' || state.type === 'google-password') {
      const label = state.type === 'security' ? 'Cloudflare 安全验证' : 'Google 密码输入';
      log(`需要人工处理：${label}。脚本会等待你完成。`);
      await notify(`需要人工处理：${label}。\n当前页面：${state.url || '(unknown)'}`);
      await waitForManualRequired(page, state.type);
      await dismissNotice(page);
    } else if (!(await advanceLoginFlow(page, state))) {
      throw new Error(`停在不可自动处理的页面，下一轮将从主页重新开始：${state.url || '(unknown)'}`);
    }

    try {
      await waitUntil('登录流程推进后出现下一步页面', async () => {
        const nextState = await getPageState(page);
        return nextState.type !== state.type || ['dashboard', 'farm', 'security', 'google-password'].includes(nextState.type);
      }, 15000);
    } catch (error) {
      log(`登录流程推进超时（尝试 ${attempt + 1}/6）：${error.message}`);
    }
    state = await getPageState(page);
  }

  if (state.type !== 'dashboard' && state.type !== 'farm') {
    throw new Error(`登录流程未进入预期状态，下一轮将从主页重新开始：${state.url || '(unknown)'}`);
  }

  return state;
}

async function reenterFarmPage(page, reason) {
  log(`重新进入农场：${reason}`);
  await page.goto(FARM_URL);
  await waitForFarmReady(page);
}

async function ensureFarmPage(page) {
  await ensureDashboardOrFarmPage(page);
  await clickFarmEntry(page);
  await waitForFarmReady(page);

  if (!(await isFarmReady(page))) {
    throw new Error('未能进入农场主体页面，停止执行，避免误判。');
  }

  log('已进入农场主体页面。');
}

async function clickHarvestButtonOnce(page) {
  return page.evaluate(`(() => {
    const buttons = Array.from(document.querySelectorAll('button')).filter((button) => {
      const value = (button.innerText || button.textContent || '').trim().replace(/\\s+/g, ' ');
      return value.includes('一键收获');
    });
    if (!buttons.length) return 'missing';
    const button = buttons[0];
    if (button.disabled) return 'disabled';
    button.scrollIntoView({ block: 'center', inline: 'center' });
    button.click();
    return 'clicked';
  })()`);
}

async function harvestIfPossible(page, { expectHarvestable = false } = {}) {
  // 先读取收获前的基准数据
  const beforeSummary = await readFarmSummary(page).catch(() => ({}));

  const clickResult = expectHarvestable
    ? await waitHumanUi('「一键收获」按钮可点击', async () => {
      const result = await clickHarvestButtonOnce(page);
      return result === 'clicked' ? result : null;
    }, { throwOnTimeout: false })
    : await clickHarvestButtonOnce(page);

  if (clickResult === 'clicked') {
    log('「一键收获」可点击，先收获。');

    // 等待收获请求完成
    log('等待收获完成...');
    await sleep(10000);

    await dismissNotice(page);
    await waitUntil('收获操作完成，页面状态改变', async () => {
      const summary = await readFarmSummary(page);
      const harvestableDropped = Number.isFinite(beforeSummary['可收获'])
        && Number.isFinite(summary['可收获'])
        && summary['可收获'] < beforeSummary['可收获'];
      const emptySlotsIncreased = Number.isFinite(beforeSummary['空闲槽位'])
        && Number.isFinite(summary['空闲槽位'])
        && summary['空闲槽位'] > beforeSummary['空闲槽位'];
      const hasPlantButton = await page.evaluate(`Array.from(document.querySelectorAll('button')).some((button) => (button.innerText || '').trim() === '种植' && !button.disabled)`);
      return harvestableDropped || emptySlotsIncreased || hasPlantButton;
    }, 10000);
    return true;
  }

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

async function hasEmptySlots(page) {
  const summary = await waitForFarmSummary(page);
  if (Number.isFinite(summary['空闲槽位'])) {
    return summary['空闲槽位'] > 0;
  }
  return page.evaluate(`Array.from(document.querySelectorAll('button')).some((button) => (button.innerText || '').trim() === '种植' && !button.disabled)`);
}

async function readHarvestReadySignal(page, beforeSummary) {
  await dismissNotice(page);
  const summary = await readFarmSummary(page);
  const beforeHarvestable = beforeSummary['可收获'];
  const beforeEmptySlots = beforeSummary['空闲槽位'];
  const harvestableDropped = Number.isFinite(beforeHarvestable)
    && Number.isFinite(summary['可收获'])
    && summary['可收获'] < beforeHarvestable;
  const emptySlotsIncreased = Number.isFinite(beforeEmptySlots)
    && Number.isFinite(summary['空闲槽位'])
    && summary['空闲槽位'] > beforeEmptySlots;
  const hasPlantableSlot = Number.isFinite(summary['空闲槽位']) && summary['空闲槽位'] > 0;
  const hasPlantButton = await page.evaluate(`Array.from(document.querySelectorAll('button')).some((button) => (button.innerText || '').trim() === '种植' && !button.disabled)`);

  return {
    ready: harvestableDropped || emptySlotsIncreased || hasPlantableSlot || hasPlantButton,
    summary,
    harvestableDropped,
    emptySlotsIncreased,
    hasPlantableSlot,
    hasPlantButton
  };
}

async function waitForHarvestReadyForPlanting(page, beforeSummary) {
  let lastSignal = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await waitHumanUi('收获后出现可继续种植的农场状态', async () => {
        lastSignal = await readHarvestReadySignal(page, beforeSummary);
        return lastSignal.ready;
      });
      return lastSignal ?? { summary: await waitForFarmSummary(page, 5000) };
    } catch (error) {
      if (attempt === 2) {
        const detail = lastSignal?.summary ? `最后读取：${JSON.stringify(lastSignal.summary)}` : error.message;
        throw new Error(`收获后没有等到可种植状态。${detail}`);
      }
      log('收获后页面状态没有刷新出空闲槽位，重新进入农场再检查。');
      await reenterFarmPage(page, '收获后重新确认空闲槽位');
    }
  }

  return { summary: await waitForFarmSummary(page, 5000) };
}

async function readFarmSummary(page) {
  return page.evaluate(`(() => {
    const labels = ['总种植', '可收获', '生长中', '空闲槽位'];
    const result = {};
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const normalize = (value) => (value || '').trim().replace(/\\s+/g, ' ');
    const all = Array.from(document.querySelectorAll('body *')).filter(visible);

    for (const label of labels) {
      const exactLabel = all.find((el) => normalize(el.innerText || el.textContent) === label);
      const candidates = [];

      if (exactLabel) {
        let cursor = exactLabel;
        for (let depth = 0; cursor && depth < 6; depth += 1) {
          const text = normalize(cursor.innerText || cursor.textContent);
          if (text.includes(label) && /\\d+/.test(text)) {
            candidates.push({ text, length: text.length });
          }
          cursor = cursor.parentElement;
        }
      }

      for (const el of all) {
        const text = normalize(el.innerText || el.textContent);
        if (text.includes(label) && /\\d+/.test(text) && text.length <= 120) {
          candidates.push({ text, length: text.length });
        }
      }

      candidates.sort((a, b) => a.length - b.length);
      const best = candidates[0];
      if (!best) continue;
      const afterLabel = best.text.slice(best.text.indexOf(label) + label.length);
      const match = afterLabel.match(/\\d+/) || best.text.match(/\\d+/);
      if (match) result[label] = Number(match[0]);
    }

    return result;
  })()`);
}

function summaryReady(summary) {
  return ['总种植', '可收获', '生长中', '空闲槽位']
    .every((label) => Number.isFinite(summary[label]));
}

async function waitForFarmSummary(page, timeout = 30000) {
  const startedAt = Date.now();
  let lastSummary = {};

  while (Date.now() - startedAt < timeout) {
    await dismissNotice(page);
    lastSummary = await readFarmSummary(page);
    if (summaryReady(lastSummary)) {
      return lastSummary;
    }
    await sleep(500);
  }

  throw new Error(`农场统计卡片未渲染完成，已等待 ${Math.round(timeout / 1000)} 秒。最后读取：${JSON.stringify(lastSummary)}`);
}

async function waitForStableFarmSummary(page, timeout = 30000) {
  const startedAt = Date.now();
  let previous = null;

  while (Date.now() - startedAt < timeout) {
    const summary = await waitForFarmSummary(page, Math.min(5000, timeout));
    const current = JSON.stringify(summary);
    if (previous === current) {
      return summary;
    }
    previous = current;
    await sleep(700);
  }

  return waitForFarmSummary(page, 5000);
}

async function getFarmStatus(page) {
  const summary = await waitForStableFarmSummary(page);
  const bodyText = await page.bodyText();
  const readNumber = (label) => {
    const match = bodyText.match(new RegExp(`${label}\\s*[:：]?\\s*(\\d+)`));
    return match ? Number(match[1]) : null;
  };
  const plantedMatch = bodyText.match(/已种植[:：]\s*(\d+)\s*\/\s*(\d+)/);
  const remainingMatches = [...bodyText.matchAll(/剩余：([^\n]+)/g)].map((match) => match[1].trim());
  const stageMatches = [...bodyText.matchAll(/阶段：([^\n]+)/g)].map((match) => match[1].trim());
  const cropMatches = [...bodyText.matchAll(getCropNamePattern())]
    .map((match) => match[1]);
  const planted = summary['总种植'] ?? (plantedMatch ? Number(plantedMatch[1]) : null);
  const totalSlots = plantedMatch ? Number(plantedMatch[2]) : null;
  const harvestable = summary['可收获'] ?? readNumber('可收获');
  const emptySlots = summary['空闲槽位'] ?? readNumber('空闲槽位');
  let growing = summary['生长中'] ?? readNumber('生长中');

  if (growing === null && planted !== null && harvestable !== null) {
    growing = Math.max(0, planted - harvestable);
  }
  if (growing === null && stageMatches.some((stage) => stage !== '成熟')) {
    growing = stageMatches.length;
  }

  return {
    planted,
    totalSlots,
    harvestable,
    growing,
    emptySlots,
    crops: [...new Set(cropMatches)],
    nextRemaining: remainingMatches.find((value) => value !== '现在可收获') || remainingMatches[0] || null
  };
}

function describeFarmStatus(status) {
  const lines = [];

  if (status.growing > 0 && (status.harvestable === 0 || status.harvestable === null)) {
    lines.push('状态：作物生长中，等待成熟。');
  } else if (status.harvestable > 0) {
    lines.push(`状态：有 ${status.harvestable} 块可收获。`);
  } else if (status.emptySlots > 0) {
    lines.push(`状态：有 ${status.emptySlots} 个空闲槽位。`);
  } else if (status.planted > 0 && status.emptySlots === 0) {
    lines.push('状态：农田已满，作物应在生长中，等待成熟。');
  } else {
    lines.push('状态：未发现可收获或可种植操作，等待下一轮检查。');
  }

  if (status.planted !== null && status.totalSlots !== null) {
    lines.push(`已种植：${status.planted}/${status.totalSlots}`);
  }
  if (status.growing !== null) lines.push(`生长中：${status.growing}`);
  if (status.harvestable !== null) lines.push(`可收获：${status.harvestable}`);
  if (status.emptySlots !== null) lines.push(`空闲槽位：${status.emptySlots}`);
  if (status.crops?.length) lines.push(`作物：${status.crops.join('、')}`);
  if (status.nextRemaining) lines.push(`剩余：${status.nextRemaining}`);

  return lines.join('\n');
}

function describeSellResult(result) {
  if (!result) return '未检查';
  if (result.sold) {
    return `成功卖出 ${result.quantity} 个${result.cropName}（${result.beforeHolding} -> ${result.afterHolding}，保留 ${result.keepSeedStock}）`;
  }
  if (result.reason === 'reserved-stock') {
    return `${result.cropName}库存 ${result.beforeHolding}，保留 ${result.keepSeedStock}，未卖出`;
  }
  return result.cropName ? `${result.cropName}未卖出` : '未卖出';
}

function describeSellResults(results) {
  if (!results) return '未检查';
  if (!results.length) return '本轮未触发卖出';
  return results.map(describeSellResult).join('\n');
}

function recordSuccessfulPlant(cropName) {
  farmState.selectedCrop = cropName;
  farmState.plantedRoundsSinceRecalc = (Number(farmState.plantedRoundsSinceRecalc) || 0) + 1;
  saveFarmState(farmState);
}

function getSellCropNamesFromStatus(status) {
  const names = status?.crops?.filter((name) => {
    const crop = getCropInfo(name);
    return crop && crop.type === 'normal';
  }) || [];
  return [...new Set(names)];
}

async function selectCropForPlanting(page, cropName) {
  return page.evaluate(`(() => {
    const cropName = ${JSON.stringify(cropName)};
    const cropNames = ${JSON.stringify(farmCrops.map((crop) => crop.name))};
    const normalize = (value) => (value || '').trim().replace(/\\s+/g, ' ');
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const all = Array.from(document.querySelectorAll('button, [role="button"], article, section, div'))
      .filter(visible)
      .map((el) => {
        const text = normalize(el.innerText || el.textContent);
        const rect = el.getBoundingClientRect();
        const interactive = el.matches('button, [role="button"]') || el.tabIndex >= 0 || getComputedStyle(el).cursor === 'pointer';
        return { el, text, rect, interactive };
      })
      .filter(({ text }) => {
        if (!text.startsWith(cropName)) return false;
        return !cropNames.some((other) => other !== cropName && text.includes(other));
      });

    const candidates = all
      .filter(({ interactive }) => interactive)
      .concat(all)
      .sort((a, b) => {
        if (a.interactive !== b.interactive) return a.interactive ? -1 : 1;
        return (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height);
      });

    if (!candidates.length) return false;
    const target = candidates[0].el;
    target.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = target.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + Math.min(rect.height * 0.45, rect.height - 4);
    const clickTarget = document.elementFromPoint(x, y) || target;
    clickTarget.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: x, clientY: y }));
    clickTarget.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }));
    clickTarget.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }));
    clickTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
    return { clicked: true, text: candidates[0].text.slice(0, 120), interactive: candidates[0].interactive };
  })()`);
}

async function waitForPlantSelectionApplied(page, cropName) {
  return waitHumanUi(`选择${cropName}后出现种植数量控件`, async (attempt) => {
    await dismissNotice(page);
    const isSelected = await isCropSelectedForPlanting(page, cropName);
    if (isSelected) return true;

    // 失败时记录调试信息
    if (attempt >= Math.floor(uiWaitAttempts / 2)) {
      const bodySnippet = await page.evaluate(`(() => {
        const normalize = (value) => (value || '').trim().replace(/\\s+/g, ' ');
        return normalize(document.body?.innerText || '').slice(0, 500);
      })()`);
      log(`未识别到${cropName}已选中。页面片段：${bodySnippet}`);
    }
    return null;
  }, { attempts: uiWaitAttempts, interval: uiWaitIntervalMs, throwOnTimeout: false });
}

async function plantCropIfPossible(page, plantPlan) {
  const cropNames = plantPlan.crops;
  const beforeStatus = await getFarmStatus(page);
  if (!(beforeStatus.emptySlots > 0)) {
    log('没有空闲槽位，不需要种植。');
    return { status: 'skipped' };
  }

  if (!(await clickFirstPlantButton(page))) {
    throw new Error('有空闲槽位，但没有找到「种植」按钮。');
  }

  log('点击第一个「种植」。');
  const dialogState = await waitForPlantDialogReady(page, cropNames);
  if (!dialogState) {
    throw new Error('点击「种植」后没有等到作物选择界面。');
  }

  const selectedCropName = cropNames[0];
  const cropAvailable = await selectCropForPlanting(page, selectedCropName);

  if (!cropAvailable?.clicked) {
    throw new Error(`没有找到可点击的「${selectedCropName}」作物卡片。`);
  }

  log(`尝试选择作物「${selectedCropName}」：${cropAvailable.text || '已点击候选卡片'}`);
  if (!(await waitForPlantSelectionApplied(page, selectedCropName))) {
    throw new Error(`点击「${selectedCropName}」后没有等到种植数量控件，停止本轮，避免误种其他作物。`);
  }

  if (!(await clickPlantMaxButton(page))) {
    const status = await getFarmStatus(page);
    if (!(await setPlantQuantityFallback(page, status.emptySlots))) {
      throw new Error('没有可点击的「最大」按钮，也没有可设置的种植数量输入框。');
    }
    log(`未找到「最大」按钮，改为输入数量 ${status.emptySlots}。`);
  } else {
    log('点击「最大」。');
  }

  const confirmReady = await waitForPlantConfirmReady(page);
  if (!confirmReady) {
    throw new Error(`点击最大后没有等到「种植 xN」确认按钮。`);
  }

  page.allowSpendConfirm(`${selectedCropName}种植消耗确认`);
  const label = await clickPlantConfirm(page);
  if (!label) {
    page.clearSpendConfirm();
    throw new Error('没有找到「种植 xN」确认按钮。');
  }

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
  return { status: 'planted', cropName: selectedCropName, attemptedCrops: cropNames };
}

async function plantCropWithRetry(page, plantPlan) {
  let lastError = null;
  const label = plantPlan.crops.join('、');

  for (let attempt = 1; attempt <= plantRetryAttempts; attempt += 1) {
    try {
      return await plantCropIfPossible(page, plantPlan);
    } catch (error) {
      page.clearSpendConfirm();
      lastError = error;
      log(`种植候选作物（${label}）第 ${attempt}/${plantRetryAttempts} 次失败：${error.message}`);
      if (attempt < plantRetryAttempts) {
        await reenterFarmPage(page, `种植候选作物失败后重试 ${attempt + 1}/${plantRetryAttempts}`);
      }
    }
  }

  throw new Error(`种植候选作物（${label}）连续 ${plantRetryAttempts} 次失败：${lastError?.message || '未知错误'}`);
}

async function waitForPlantApplied(page, beforeStatus, cropName) {
  await waitUntil(`种植后${cropName}进入生长状态`, async () => {
    await dismissNotice(page);
    const status = await getFarmStatus(page);
    const emptySlotsReduced = Number.isFinite(beforeStatus.emptySlots)
      && Number.isFinite(status.emptySlots)
      && status.emptySlots < beforeStatus.emptySlots;
    const plantedIncreased = Number.isFinite(beforeStatus.planted)
      && Number.isFinite(status.planted)
      && status.planted > beforeStatus.planted;
    const hasTargetCrop = status.crops.includes(cropName);
    const hasGrowingSignal = status.growing > 0 || Boolean(status.nextRemaining);
    return (emptySlotsReduced || plantedIncreased || status.emptySlots === 0) && hasTargetCrop && hasGrowingSignal;
  }, 30000);
}

async function waitForRecycleReady(page) {
  await waitHumanUi('交易所页面加载完成', async () => {
    await dismissNotice(page);
    const bodyText = await page.bodyText();
    return bodyText.includes('交易所') && bodyText.includes('快速卖出') && bodyText.includes('作物') && bodyText.includes('持有');
  });
}

async function enterRecyclePage(page, reason) {
  log(`进入交易所：${reason}`);
  await page.goto(RECYCLE_URL);
  await waitForRecycleReady(page);
}

async function readExchangePrices(page) {
  return page.evaluate(`(() => {
    const cropNames = ${JSON.stringify(farmCrops.map((crop) => crop.name))};
    const lines = (document.body.innerText || '').split(/\\n+/).map((line) => line.trim()).filter(Boolean);
    const prices = {};
    for (let index = 0; index < lines.length; index += 1) {
      const cropName = lines[index];
      if (!cropNames.includes(cropName)) continue;
      const priceLine = lines.slice(index + 1, index + 9).find((line) => /^\\$\\d+(?:\\.\\d+)?$/.test(line));
      if (priceLine) prices[cropName] = Number(priceLine.slice(1));
    }
    return prices;
  })()`);
}

async function readProfitRankingFromRecycle(page) {
  await enterRecyclePage(page, '读取交易所行情并计算种植收益');
  const exchangePrices = await waitHumanUi('交易所现价读取完成', async () => {
    const prices = await readExchangePrices(page);
    return Object.keys(prices).length > 0 ? prices : null;
  });
  const ranking = rankCropsByProfit(getAllowedPlantCrops(), exchangePrices);
  if (!ranking.length) {
    throw new Error('交易所没有读到可用于收益计算的普通作物价格。');
  }
  return { exchangePrices, ranking };
}

async function resolvePlantStrategy(page) {
  if (!isAutoPlantMode()) {
    return {
      mode: 'fixed',
      selectedCrop: STATIC_PLANT_CROP_NAME,
      crops: [STATIC_PLANT_CROP_NAME],
      ranking: [],
      recalculated: false
    };
  }

  const needsRecalc = !farmState.selectedCrop
    || !farmState.lastProfitRanking?.length
    || farmState.plantedRoundsSinceRecalc >= strategyRecalcRounds;

  if (!needsRecalc) {
    const lockedCrop = getPersistedCropName();
    return {
      mode: 'auto',
      selectedCrop: lockedCrop,
      crops: [lockedCrop],
      ranking: farmState.lastProfitRanking,
      recalculated: false
    };
  }

  try {
    const { exchangePrices, ranking } = await readProfitRankingFromRecycle(page);
    const selectedCrop = ranking[0].name;
    farmState.selectedCrop = selectedCrop;
    farmState.recommendedCrop = selectedCrop;
    farmState.plantedRoundsSinceRecalc = 0;
    farmState.lastStrategyAt = new Date().toISOString();
    farmState.lastExchangePrices = exchangePrices;
    farmState.lastProfitRanking = serializeRanking(ranking);
    saveFarmState(farmState);
    log(`自动策略重算完成：${selectedCrop}。收益前三：${ranking.slice(0, 3).map((item) => `${item.name} ${roundMoney(item.dailyProfit)}/天`).join('，')}`);
    return {
      mode: 'auto',
      selectedCrop,
      crops: [selectedCrop],
      ranking: farmState.lastProfitRanking,
      recalculated: true
    };
  } catch (error) {
    log(`自动策略重算失败，继续使用本地状态：${error.message}`);
    const fallbackCrop = getPersistedCropName();
    return {
      mode: 'auto',
      selectedCrop: fallbackCrop,
      crops: [fallbackCrop],
      ranking: farmState.lastProfitRanking || [],
      recalculated: false,
      error: error.message
    };
  }
}

async function readCropHoldingFromRecycle(page, cropName) {
  return page.evaluate(`(() => {
    const cropName = ${JSON.stringify(cropName)};
    const normalize = (value) => (value || '').trim().replace(/\\s+/g, ' ');
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const buttons = Array.from(document.querySelectorAll('button')).filter(visible);
    const row = buttons
      .map((button) => normalize(button.innerText || button.textContent))
      .find((text) => text.startsWith(cropName + ' ') && /\\$/.test(text));
    if (!row) return null;
    const match = row.match(new RegExp('^' + cropName + '\\\\s+(\\\\d+)\\\\s+\\\\$'));
    return match ? Number(match[1]) : null;
  })()`);
}

async function waitForCropHolding(page, cropName) {
  return waitHumanUi(`交易所读取${cropName}持有数量`, async () => {
    const holding = await readCropHoldingFromRecycle(page, cropName);
    return Number.isFinite(holding) ? holding : null;
  });
}

async function openQuickSellDialog(page) {
  await dismissNotice(page);
  const opened = await clickEnabledButtonExact(page, '快速卖出');
  if (!opened) {
    throw new Error('没有找到可点击的「快速卖出」按钮');
  }

  return waitHumanUi('快速卖出弹窗加载完成', async () => {
    await dismissNotice(page);
    const bodyText = await page.bodyText();
    return bodyText.includes('勾选作物并调整数量') ? true : null;
  });
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

    for (const input of inputs) {
      let cursor = input;
      for (let depth = 0; cursor && depth < 8; depth += 1) {
        const text = normalize(cursor.innerText || cursor.textContent);

        // 改进的匹配逻辑：更宽松，支持不同的格式
        // 匹配格式1: "玉米 已选 0 / 库存 150"
        let match = text.match(new RegExp(cropName + '\\\\s+已选\\\\s+\\\\d+\\\\s*\\/\\\\s*库存\\\\s+(\\\\d+)'));

        // 匹配格式2: 包含作物名和"库存"关键词
        if (!match && text.includes(cropName) && text.includes('库存')) {
          const stockMatch = text.match(/库存\\s*(\\d+)/);
          if (stockMatch) {
            match = [null, stockMatch[1]];
          }
        }

        if (match) {
          const stock = Number(match[1]);
          if (quantity < 0 || quantity > stock) return { selected: false, stock, quantity, reason: 'quantity-out-of-range' };
          input.scrollIntoView({ block: 'center', inline: 'center' });
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(input, String(quantity));
          else input.value = String(quantity);
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('blur', { bubbles: true }));
          return { selected: true, stock, quantity };
        }
        cursor = cursor.parentElement;
      }
    }

    return { selected: false, stock: null, quantity, reason: 'crop-input-not-found' };
  })()`);
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

    const nodes = Array.from(document.querySelectorAll('body *')).filter(visible);
    for (const el of nodes) {
      const text = normalize(el.innerText || el.textContent);
      const match = text.match(new RegExp(cropName + '\\\\s+已选\\\\s+(\\\\d+)\\\\s*\\/\\\\s*库存\\\\s+(\\\\d+)'));
      if (match) {
        return { selected: Number(match[1]), stock: Number(match[2]) };
      }
    }
    return null;
  })()`);
}

async function clickQuickSellConfirm(page) {
  return page.evaluate(`(() => {
    const normalize = (value) => (value || '').trim().replace(/\\s+/g, ' ');
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    const button = Array.from(document.querySelectorAll('button'))
      .filter(visible)
      .find((candidate) => {
        const text = normalize(candidate.innerText || candidate.textContent);
        return !candidate.disabled && /^确认卖出/.test(text);
      });
    if (!button) return null;
    const label = normalize(button.innerText || button.textContent);
    button.scrollIntoView({ block: 'center', inline: 'center' });
    button.click();
    return label;
  })()`);
}

async function sellCropIfNeeded(page, cropName, options = {}) {
  await enterRecyclePage(page, `检查${cropName}库存`);
  const beforeHolding = await waitForCropHolding(page, cropName);
  const keepStock = Number.isFinite(options.keepStock) ? options.keepStock : keepSeedStock;
  const sellQuantity = Number.isFinite(options.quantity)
    ? options.quantity
    : Math.max(0, beforeHolding - keepStock);

  if (sellQuantity <= 0) {
    log(`${cropName}持有 ${beforeHolding}，保留 ${keepStock} 个种子，不卖出。`);
    return {
      sold: false,
      cropName,
      beforeHolding,
      afterHolding: beforeHolding,
      quantity: 0,
      keepSeedStock: keepStock,
      reason: 'reserved-stock'
    };
  }
  if (sellQuantity > beforeHolding) {
    throw new Error(`${cropName}库存 ${beforeHolding}，无法卖出 ${sellQuantity}。`);
  }

  log(`${cropName}持有 ${beforeHolding}，保留 ${keepStock}，准备卖出 ${sellQuantity}。`);
  await openQuickSellDialog(page);
  const selected = await setCropQuantityInQuickSell(page, cropName, sellQuantity);
  if (!selected.selected) {
    throw new Error(`快速卖出弹窗没有找到可设置数量的${cropName}行：${JSON.stringify(selected)}`);
  }

  let lastSelection = null;
  try {
    await waitUntil('数量设置生效', async () => {
      lastSelection = await readQuickSellCropSelection(page, cropName);
      return lastSelection && lastSelection.stock === beforeHolding && lastSelection.selected === sellQuantity;
    }, 5000);
  } catch (error) {
    throw new Error(`数量设置未生效。期望：选中 ${sellQuantity}，库存 ${beforeHolding}；实际：${JSON.stringify(lastSelection)}。原始错误：${error.message}`);
  }

  const selection = await readQuickSellCropSelection(page, cropName);
  if (!selection || selection.stock !== beforeHolding || selection.selected !== sellQuantity) {
    throw new Error(`卖出前未能确认只选择了${cropName} ${sellQuantity} 个。选择状态：${JSON.stringify(selection)}`);
  }

  page.allowSpendConfirm(`${cropName}卖出确认`);
  const label = await clickQuickSellConfirm(page);
  if (!label) {
    page.clearSpendConfirm();
    throw new Error('没有找到「确认卖出」按钮。');
  }
  log(`确认 ${label}`);

  try {
    // 等待售卖请求完成
    log('等待售卖完成...');
    await sleep(10000);  // 等待 10 秒让服务器处理

    await dismissNotice(page);
    await enterRecyclePage(page, `卖出后验证${cropName}库存`);
    const afterHolding = await waitForCropHolding(page, cropName);
    const expectedAfter = beforeHolding - sellQuantity;
    if (afterHolding !== expectedAfter) {
      throw new Error(`卖出后${cropName}持有异常：期望 ${expectedAfter}，实际 ${afterHolding}`);
    }
    return { sold: true, cropName, beforeHolding, afterHolding, quantity: sellQuantity, keepSeedStock: keepStock };
  } finally {
    page.clearSpendConfirm();
  }
}

async function sellCropWithRetry(page, cropName, dynamicKeepStock) {
  let lastError = null;

  for (let attempt = 1; attempt <= sellRetryAttempts; attempt += 1) {
    try {
      return await sellCropIfNeeded(page, cropName, { keepStock: dynamicKeepStock });
    } catch (error) {
      page.clearSpendConfirm();
      lastError = error;
      log(`卖${cropName}第 ${attempt}/${sellRetryAttempts} 次失败：${error.message}`);
      if (attempt < sellRetryAttempts) {
        await enterRecyclePage(page, `卖${cropName}失败后重试 ${attempt + 1}/${sellRetryAttempts}`);
      }
    }
  }

  throw new Error(`卖${cropName}连续 ${sellRetryAttempts} 次失败：${lastError?.message || '未知错误'}`);
}

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

async function runSellDiagnostic(page, cropName, quantity) {
  if (!cropName) {
    throw new Error('测试售卖需要指定作物，例如：--test-sell 南瓜 --quantity 1');
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('测试售卖需要指定正整数数量，例如：--quantity 1');
  }

  log(`进入测试售卖模式：使用生产售卖逻辑卖出 ${quantity} 个${cropName}。`);
  const result = await sellCropIfNeeded(page, cropName, {
    quantity,
    keepStock: 0
  });
  log(`测试售卖完成：${cropName} ${result.beforeHolding} -> ${result.afterHolding}，卖出 ${result.quantity}。`);
  return result;
}

async function runFarmOnce(page) {
  await ensureFarmPage(page);
  let beforeHarvestSummary = await waitForFarmSummary(page);
  let beforeHarvestStatus = await getFarmStatus(page);
  let harvested = await harvestIfPossible(page, { expectHarvestable: beforeHarvestSummary['可收获'] > 0 });
  if (!harvested && beforeHarvestSummary['可收获'] > 0) {
    log('统计显示已有可收获作物，但等待后「一键收获」仍不可用；重新进入农场后再试一次。');
    await reenterFarmPage(page, '可收获但按钮未刷新');
    beforeHarvestSummary = await waitForFarmSummary(page);
    beforeHarvestStatus = await getFarmStatus(page);
    harvested = await harvestIfPossible(page, { expectHarvestable: beforeHarvestSummary['可收获'] > 0 });
  }
  let sellResults = [];
  if (harvested) {
    await reenterFarmPage(page, '收获后刷新空闲槽位');
    const harvestSignal = await waitForHarvestReadyForPlanting(page, beforeHarvestSummary);
    const afterHarvestStatus = await getFarmStatus(page);
    const emptySlots = harvestSignal.summary?.['空闲槽位'];
    const harvestedCropNames = getSellCropNamesFromStatus(beforeHarvestStatus);
    log([
      '一键收获成功，农场已刷新出可继续种植状态。',
      Number.isFinite(emptySlots) ? `空闲槽位：${emptySlots}` : null,
      harvestedCropNames.length ? `准备卖出：${harvestedCropNames.join('、')}。` : null
    ].filter(Boolean).join('\n'));
    if (harvestedCropNames.length) {
      sellResults = await sellHarvestedCropsWithRetry(page, harvestedCropNames, afterHarvestStatus);
    }
  }

  const strategy = await resolvePlantStrategy(page);
  await reenterFarmPage(page, '种植前回到农场');
  const plantResult = await plantCropWithRetry(page, strategy);
  const planted = plantResult.status === 'planted';
  const noCrop = plantResult.status === 'no-crop';
  const plantedCrop = plantResult.cropName || strategy.selectedCrop;
  if (planted) recordSuccessfulPlant(plantedCrop);
  if (planted) await reenterFarmPage(page, '种植后刷新生长状态');
  const status = await getFarmStatus(page);
  log('本轮完成。');
  return { harvested, planted, noCrop, plantCrop: plantedCrop, status, sellResults, strategy };
}

function formatNextRun(date) {
  return date.toLocaleString('zh-CN', { hour12: false });
}

function parseRemainingMs(value) {
  if (!value || value === '现在可收获') return 0;

  let totalSeconds = 0;
  const day = value.match(/(\d+)\s*天/);
  const hour = value.match(/(\d+)\s*小时/);
  const minute = value.match(/(\d+)\s*分钟/);
  const second = value.match(/(\d+)\s*秒/);

  if (day) totalSeconds += Number(day[1]) * 24 * 60 * 60;
  if (hour) totalSeconds += Number(hour[1]) * 60 * 60;
  if (minute) totalSeconds += Number(minute[1]) * 60;
  if (second) totalSeconds += Number(second[1]);

  return totalSeconds > 0 ? totalSeconds * 1000 : null;
}

function getNextDelayMs(status, { failed = false, noCrop = false } = {}) {
  if (failed) {
    return failureRetryMs;
  }
  if (noCrop) {
    return actionRetryMs;
  }
  if (status?.harvestable > 0 || status?.emptySlots > 0) {
    return actionRetryMs;
  }

  const remainingMs = parseRemainingMs(status?.nextRemaining);
  if (remainingMs !== null) {
    return Math.max(actionRetryMs, remainingMs + matureBufferSeconds * 1000);
  }

  return intervalMs;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [];
  if (hours) parts.push(`${hours}小时`);
  if (minutes) parts.push(`${minutes}分钟`);
  if (seconds || parts.length === 0) parts.push(`${seconds}秒`);
  return parts.join('');
}

async function main() {
  log(`连接专用 Chrome：${CDP_ORIGIN}`);
  let page = await getOrCreatePage();
  let forceFreshPage = false;
  let consecutiveFailures = 0;

  try {
    if (testSellCropName) {
      await runSellDiagnostic(page, testSellCropName, testSellQuantity);
    } else if (watchMode) {
      log(`进入常驻模式：优先按作物剩余时间等待；解析不到时每 ${intervalMinutes} 分钟检查一次。按 Ctrl+C 停止。`);
      while (true) {
        let result = null;
        let failed = false;
        try {
          if (!page) {
            page = await getOrCreatePage({ fresh: forceFreshPage });
            forceFreshPage = false;
          }
          result = await runFarmOnce(page);
          consecutiveFailures = 0;
        } catch (error) {
          failed = true;
          consecutiveFailures += 1;
          console.error(`[farm-bot] 本轮失败（连续 ${consecutiveFailures} 次）：${error.message}`);
          if (consecutiveFailures >= 3) {
            await notify(`连续失败 ${consecutiveFailures} 次：${error.message}\n${failureRetrySeconds} 秒后会打开新标签页，并从主页重新开始。`);
          }
          await page?.close().catch(() => {});
          page = null;
          forceFreshPage = true;
        }

        const delayMs = getNextDelayMs(result?.status, { failed, noCrop: result?.noCrop });
        const nextRunAt = new Date(Date.now() + delayMs);
        log(`等待下一轮：${formatDuration(delayMs)}后，${formatNextRun(nextRunAt)}`);
        if (result) {
          await notify(`本轮检查完成。\n收获：${result.harvested ? '成功' : '本轮无可收获'}\n种植：${result.planted ? `成功种植${result.plantCrop}` : result.noCrop ? `候选作物无库存，等待补货` : '本轮未种植'}\n卖出：${describeSellResults(result.sellResults)}\n${describeStrategy(result.strategy)}\n${describeFarmStatus(result.status)}\n下次检查：${formatNextRun(nextRunAt)}`);
        }
        await sleep(delayMs);
      }
    } else {
      let result;
      try {
        result = await runFarmOnce(page);
      } catch (error) {
        log(`单次流程首次失败，改用新标签页重试：${error.message}`);
        await page?.close().catch(() => {});
        page = await getOrCreatePage({ fresh: true });
        result = await runFarmOnce(page);
      }
      log('流程结束，等待作物成熟即可。');
      await notify(`单次流程结束。\n收获：${result.harvested ? '成功' : '本轮无可收获'}\n种植：${result.planted ? `成功种植${result.plantCrop}` : result.noCrop ? `候选作物无库存，等待补货` : '本轮未种植'}\n卖出：${describeSellResults(result.sellResults)}\n${describeStrategy(result.strategy)}\n${describeFarmStatus(result.status)}`);
    }
  } finally {
    await page.close();
  }
}

main().catch((error) => {
  console.error(`[farm-bot] 失败：${error.message}`);
  process.exitCode = 1;
});
