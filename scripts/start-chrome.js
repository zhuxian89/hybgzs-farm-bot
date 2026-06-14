import { launchDedicatedChrome } from './chrome-launcher.js';
import { farmConfig } from './farm-config.js';

const port = String(farmConfig.chrome.debugPort);
const { chromePath, chromeProfileDir } = launchDedicatedChrome({ port });

console.log(`[farm-bot] 启动专用 Chrome：${chromePath}`);
console.log(`[farm-bot] Profile：${chromeProfileDir}`);
console.log(`[farm-bot] 调试端口：http://127.0.0.1:${port}`);
console.log('[farm-bot] 请在打开的 Chrome 里手动完成 Cloudflare / 登录 / 授权。完成后保持 Chrome 开着，再运行：npm run farm');
