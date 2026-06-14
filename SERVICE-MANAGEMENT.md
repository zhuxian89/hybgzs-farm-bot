# Farm Bot 服务管理

## 服务信息

- **LaunchAgent 配置**: `/Users/hongweizhang/Library/LaunchAgents/com.hybgzs.farm-bot.plist`
- **工作目录**: `/Users/hongweizhang/java_project/hybgzs-farm-bot`
- **执行命令**: `/usr/bin/caffeinate -dimsu /Users/hongweizhang/.local/bin/node scripts/farm-bot.js --watch`
- **日志文件**: 
  - 标准输出: `/Users/hongweizhang/java_project/hybgzs-farm-bot/logs/farm-watch.log`
  - 错误输出: `/Users/hongweizhang/java_project/hybgzs-farm-bot/logs/farm-watch.err.log`

## 常用命令

### 查看服务状态
```bash
launchctl print gui/$(id -u)/com.hybgzs.farm-bot
```

### 停止服务
```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.hybgzs.farm-bot.plist
```

### 启动服务
```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hybgzs.farm-bot.plist
```

### 重启服务（先停止再启动）
```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.hybgzs.farm-bot.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hybgzs.farm-bot.plist
launchctl kickstart -k gui/$(id -u)/com.hybgzs.farm-bot
```

### 快速重启（推荐）
```bash
launchctl kickstart -k gui/$(id -u)/com.hybgzs.farm-bot
```

## 日志查看

### 实时查看运行日志
```bash
tail -f /Users/hongweizhang/java_project/hybgzs-farm-bot/logs/farm-watch.log
```

### 实时查看错误日志
```bash
tail -f /Users/hongweizhang/java_project/hybgzs-farm-bot/logs/farm-watch.err.log
```

### 查看最近 50 行日志
```bash
tail -50 /Users/hongweizhang/java_project/hybgzs-farm-bot/logs/farm-watch.log
```

### 搜索日志中的错误
```bash
grep -i error /Users/hongweizhang/java_project/hybgzs-farm-bot/logs/farm-watch.log
```

## 服务状态检查

### 检查是否运行
```bash
launchctl print gui/$(id -u)/com.hybgzs.farm-bot 2>&1 | grep -E "state|pid"
```

预期输出（运行中）：
```
state = running
pid = 12345
```

### 检查进程
```bash
ps aux | grep "farm-bot.js" | grep -v grep
```

## 修改代码后重启

当你修改了 `scripts/farm-bot.js` 后，需要重启服务以应用更改：

```bash
# 方法1：快速重启（推荐）
launchctl kickstart -k gui/$(id -u)/com.hybgzs.farm-bot

# 方法2：完整重启
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.hybgzs.farm-bot.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.hybgzs.farm-bot.plist
```

## 调试技巧

### 手动运行脚本（不通过 LaunchAgent）
```bash
cd /Users/hongweizhang/java_project/hybgzs-farm-bot
node scripts/farm-bot.js --watch
```

### 查看最后一次崩溃信息
```bash
tail -100 /Users/hongweizhang/java_project/hybgzs-farm-bot/logs/farm-watch.err.log
```

### 清空日志重新开始
```bash
> /Users/hongweizhang/java_project/hybgzs-farm-bot/logs/farm-watch.log
> /Users/hongweizhang/java_project/hybgzs-farm-bot/logs/farm-watch.err.log
launchctl kickstart -k gui/$(id -u)/com.hybgzs.farm-bot
```

## caffeinate 说明

`caffeinate -dimsu` 的作用：
- `-d`: 防止显示器休眠
- `-i`: 防止系统空闲休眠
- `-m`: 防止磁盘休眠
- `-s`: 防止系统休眠（需要电源适配器）
- `-u`: 声明用户活跃

这确保脚本可以长时间不间断运行。

## 故障排查

### 服务无法启动
1. 检查配置文件是否存在：
   ```bash
   ls -la ~/Library/LaunchAgents/com.hybgzs.farm-bot.plist
   ```

2. 检查配置文件语法：
   ```bash
   plutil -lint ~/Library/LaunchAgents/com.hybgzs.farm-bot.plist
   ```

3. 查看系统日志：
   ```bash
   log show --predicate 'subsystem == "com.apple.launchd"' --last 10m | grep farm-bot
   ```

### 脚本运行但不工作
1. 查看错误日志
2. 检查 Chrome 是否在 9222 端口运行
3. 手动运行脚本测试

### 服务频繁重启
查看错误日志找出崩溃原因：
```bash
tail -100 /Users/hongweizhang/java_project/hybgzs-farm-bot/logs/farm-watch.err.log
```

## 最近更新

**2026-06-14**: 修复所有点击等待逻辑，将固定 sleep 改为循环检查预期结果，真正模拟人类操作。详见 `CHANGELOG-wait-fix.md`。
