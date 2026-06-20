#!/usr/bin/env node
import WebSocket from 'ws';

async function getTargetInfo() {
  const response = await fetch('http://127.0.0.1:9222/json');
  const targets = await response.json();
  return targets.find(t => t.type === 'page');
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

const page = await connectPage();

// 检查输入框
const result = await page.evaluate(`(() => {
  const inputs = Array.from(document.querySelectorAll('input[type="number"]'));
  
  return inputs.map((input, i) => {
    let parent = input.parentElement;
    let text = '';
    for (let depth = 0; parent && depth < 5; depth++) {
      const t = (parent.innerText || '').trim();
      if (t.includes('南瓜')) {
        text = t;
        break;
      }
      parent = parent.parentElement;
    }
    
    return {
      index: i,
      value: input.value,
      disabled: input.disabled,
      readOnly: input.readOnly,
      visible: getComputedStyle(input).display !== 'none',
      parentText: text.substring(0, 100)
    };
  });
})()`);

console.log('输入框信息:');
console.log(JSON.stringify(result, null, 2));

page.ws.close();
