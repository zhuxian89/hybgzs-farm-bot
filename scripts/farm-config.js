import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const projectRoot = path.resolve(__dirname, '..');
export const FARM_CONFIG_FILE = path.join(projectRoot, 'farm-config.json');

const defaultConfig = {
  chrome: {
    debugPort: 9222,
    chromePath: null,
    cdpOrigin: null
  },
  timing: {
    stepTimeoutMs: 45000,
    manualTimeoutMs: 600000,
    cdpCommandTimeoutMs: 15000,
    intervalMinutes: 10,
    matureBufferSeconds: 120,
    actionRetryMinutes: 3,
    failureRetrySeconds: 10,
    uiWaitAttempts: 5,
    uiWaitSeconds: 10
  },
  retries: {
    plantAttempts: 3,
    sellAttempts: 2
  },
  strategy: {
    plantCrop: 'auto',
    maxSeedPrice: 8,
    recalcAfterSuccessfulPlantRounds: 6,
    keepSeedStock: 6
  }
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeConfig(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (isPlainObject(value) && isPlainObject(base[key])) {
      result[key] = mergeConfig(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function loadEnvFile(filePath = path.join(projectRoot, '.env')) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function loadFarmConfig(filePath = FARM_CONFIG_FILE) {
  if (!fs.existsSync(filePath)) return defaultConfig;

  try {
    const localConfig = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return mergeConfig(defaultConfig, localConfig);
  } catch (error) {
    throw new Error(`读取配置文件失败：${filePath}。${error.message}`);
  }
}

loadEnvFile();

export const farmConfig = loadFarmConfig();
