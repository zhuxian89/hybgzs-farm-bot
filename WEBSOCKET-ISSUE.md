# WebSocket 频繁断连问题调研

## 🔍 问题现象

连续失败提示：
```
连续失败 5 次：等待超时：点击「进入农场」后进入农场页面，已按 10秒 间隔检查 5 次。
最后错误：CDP WebSocket 未连接，无法执行 Runtime.evaluate
```

## 📊 调研发现

### 1. WebSocket 生命周期

**连接创建**（`CdpPage.connect()`）：
```javascript
this.ws = new WebSocket(this.wsUrl);
this.ws.on('close', () => { /* 关闭时拒绝所有待处理请求 */ });
this.ws.on('error', (error) => { /* 错误时拒绝所有待处理请求 */ });
```

**发送命令检查**（`CdpPage.send()`）：
```javascript
if (this.ws?.readyState !== WebSocket.OPEN) {
  return Promise.reject(new Error(`CDP WebSocket 未连接，无法执行 ${method}`));
}
```

**问题**：没有自动重连机制！

### 2. 失败处理流程

```
runFarmOnce() 失败
  ↓
consecutiveFailures++
  ↓
关闭 page（断开 WebSocket）
  ↓
设置 forceFreshPage = true
  ↓
下一轮：getOrCreatePage({ fresh: true })
  ↓
创建新标签页 + 新 WebSocket
```

**问题**：
- 每次失败都创建新标签页（资源浪费）
- WebSocket 断开后不尝试重连当前连接
- 没有区分"页面问题"和"连接问题"

### 3. 可能的断连原因

#### 3.1 Chrome 侧主动关闭
- Chrome 标签页崩溃
- Chrome 内存不足杀进程
- Chrome 更新/重启

#### 3.2 网络原因
- 网络波动
- 代理切换（Clash Verge 节点切换）
- 本地防火墙

#### 3.3 长时间空闲
- WebSocket 长时间无数据传输
- 路由器/防火墙超时断连
- Chrome 空闲标签页休眠

#### 3.4 CDP 超时
```javascript
const timer = setTimeout(() => {
  this.unusable = true;
  if (this.ws?.readyState === WebSocket.OPEN) {
    this.ws.close();  // 主动关闭！
  }
  reject(new Error(`CDP 命令超时：${method}...`));
}, cdpCommandTimeoutMs);
```

**超时会主动关闭 WebSocket！**

### 4. 当前缓解措施

✅ **已有**：
- 失败后关闭旧页面
- 创建新标签页重试
- 连续失败 3 次通知用户

❌ **缺失**：
- WebSocket 断线重连
- 心跳保活机制
- 区分临时故障和永久故障

## 💡 改进方案

### 方案 1：WebSocket 自动重连（推荐）

```javascript
class CdpPage {
  async reconnect() {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
    }
    await this.connect();
  }
  
  send(method, params = {}) {
    // 如果未连接，先尝试重连
    if (this.ws?.readyState !== WebSocket.OPEN) {
      return this.reconnect().then(() => this.send(method, params));
    }
    // ... 原有逻辑
  }
}
```

**优点**：
- 无需创建新标签页
- 保持页面状态
- 减少资源开销

**缺点**：
- 如果页面本身有问题，重连也没用

### 方案 2：WebSocket 心跳保活

```javascript
// 每 30 秒发送一次心跳
setInterval(() => {
  if (this.ws?.readyState === WebSocket.OPEN) {
    this.send('Browser.getVersion').catch(() => {});
  }
}, 30000);
```

**优点**：
- 防止长时间空闲断连
- 及早发现连接问题

**缺点**：
- 增加轻微开销

### 方案 3：智能重试策略

```javascript
// 区分错误类型
if (error.message.includes('WebSocket')) {
  // WebSocket 问题：先尝试重连，不创建新标签页
  await page.reconnect();
} else if (error.message.includes('等待超时')) {
  // 页面问题：创建新标签页
  await page?.close();
  page = await getOrCreatePage({ fresh: true });
}
```

**优点**：
- 针对性处理
- 减少不必要的新标签页

### 方案 4：Chrome 进程监控

```javascript
// 定期检查 Chrome 是否活着
setInterval(async () => {
  try {
    await fetch(`${CDP_ORIGIN}/json/version`);
  } catch {
    log('Chrome 无响应，尝试重启...');
    await ensureDedicatedChrome();
  }
}, 60000);
```

## 📈 数据收集

建议添加日志统计：
```javascript
let stats = {
  totalRuns: 0,
  websocketErrors: 0,
  timeouts: 0,
  reconnects: 0,
  newTabs: 0
};
```

## 🎯 建议优先级

1. **高优先级**：方案 2（心跳保活）- 简单有效
2. **中优先级**：方案 3（智能重试）- 减少资源浪费
3. **低优先级**：方案 1（自动重连）- 复杂度较高

## 🔧 临时缓解

如果频繁断连：
1. 检查 Clash 代理是否稳定
2. 检查系统内存是否充足
3. 减少 Chrome 标签页数量
4. 调整 `cdpCommandTimeoutMs`（默认值？）
