import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { farmConfig, FARM_CONFIG_FILE, projectRoot } from './farm-config.js';

export const chromeProfileDir = path.join(projectRoot, 'chrome-profile');

const chromeCandidates = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
];

export function findChromePath() {
  const configuredChromePath = String(farmConfig.chrome.chromePath || '').trim();
  if (configuredChromePath) {
    if (!fs.existsSync(configuredChromePath)) {
      throw new Error(`farm-config.json 里的 chrome.chromePath 不存在：${configuredChromePath}`);
    }
    return configuredChromePath;
  }

  return chromeCandidates.find((candidate) => fs.existsSync(candidate));
}

export function launchDedicatedChrome({ port = '9222', url = 'https://cdk.hybgzs.com/' } = {}) {
  const chromePath = findChromePath();
  if (!chromePath) {
    throw new Error(`找不到 Google Chrome。请在 ${FARM_CONFIG_FILE} 里填写 chrome.chromePath 后重试。`);
  }

  fs.mkdirSync(chromeProfileDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${chromeProfileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    url
  ];

  const child = spawn(chromePath, args, {
    detached: true,
    stdio: 'ignore'
  });

  child.unref();
  return { chromePath, chromeProfileDir, port };
}
