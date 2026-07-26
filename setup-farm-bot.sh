#!/bin/bash
# 部署 farm-bot 的 launchd 看护服务（com.hybgzs.farm-bot）
# 特性：崩溃自愈（KeepAlive）+ 登录自启（RunAtLoad），与防休眠（com.hybgzs.caffeinate）分立。
# 部署一次即可，Mac 重登/重启后自动恢复。
# 注意：plist 烘焙本机的 node 绝对路径与项目根；node 升级或项目搬家后须重跑本脚本。

set -e

LABEL="com.hybgzs.farm-bot"
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST="$PLIST_DIR/${LABEL}.plist"
ENTRY="$PROJECT_ROOT/scripts/farm-bot.js"
LOG_OUT="$PROJECT_ROOT/logs/farm-watch.log"
LOG_ERR="$PROJECT_ROOT/logs/farm-watch.err.log"
DOMAIN="gui/$(id -u)"

# 1. 解析 node 绝对路径（launchd 无 shell PATH，plist 必须用绝对路径）
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
    echo "❌ 未找到 node（command -v node 失败）。请确认 node 在 PATH 中后重跑本脚本。"
    exit 1
fi
NODE_DIR="$(dirname "$NODE_BIN")"

# 2. 前置检查
if [ ! -f "$ENTRY" ]; then
    echo "❌ 找不到入口脚本：$ENTRY"
    exit 1
fi
mkdir -p "$PLIST_DIR" "$PROJECT_ROOT/logs" "$PROJECT_ROOT/data"

# 2.5 预检：若有非本服务管理的 farm-bot 进程（手动/nohup），会与新实例撞锁 → crash-loop
LAUNCHD_PID="$(launchctl print "$DOMAIN/$LABEL" 2>/dev/null | awk '/pid =/ {print $3; exit}' || true)"
ROGUE=""
for pid in $(pgrep -f 'node.*farm-bot.js' 2>/dev/null || true); do
    [ "$pid" != "$LAUNCHD_PID" ] && ROGUE="$ROGUE $pid"
done
if [ -n "$ROGUE" ]; then
    echo "❌ 检测到非本服务管理的 farm-bot 进程（PID:${ROGUE}）。"
    echo "   并存会撞锁导致 crash-loop。请先停掉它（kill${ROGUE}）或用 ./start.sh 重启后再部署。"
    exit 1
fi

# 3. 卸载旧实例（如有）——幂等：重复跑不报错
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true

# 4. 写入 plist
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${NODE_BIN}</string>
        <string>${ENTRY}</string>
        <string>--watch</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>${PROJECT_ROOT}</string>
    <key>StandardOutPath</key>
    <string>${LOG_OUT}</string>
    <key>StandardErrorPath</key>
    <string>${LOG_ERR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>${NODE_DIR}:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>${HOME}</string>
    </dict>
</dict>
</plist>
EOF

# 5. 自检 plist 合法性（fail-fast：路径含 & < > 等会生成非法 plist）
if ! plutil -lint "$PLIST" >/dev/null 2>&1; then
    echo "❌ 生成的 plist 非法：$PLIST（检查路径是否含 & < > 等特殊字符）"
    exit 1
fi

# 6. 注册（现代 API）
if ! launchctl bootstrap "$DOMAIN" "$PLIST"; then
    echo "❌ bootstrap 失败，请检查 $PLIST（plutil -lint $PLIST）与 $LOG_ERR"
    exit 1
fi

# 7. 验证（不仅看注册，还看进程真在跑——避免 crash-loop 时误报成功）
sleep 3
if launchctl print "$DOMAIN/$LABEL" 2>/dev/null | grep -q "state = running" \
   && pgrep -f 'node.*farm-bot.js --watch' >/dev/null 2>&1; then
    echo "✅ farm-bot launchd 看护已部署并运行"
    echo "   Label:  $LABEL"
    echo "   plist:  $PLIST"
    echo "   node:   $NODE_BIN"
    echo "   入口:   $ENTRY"
    echo "   日志:   $LOG_OUT / $LOG_ERR"
    echo "   特性:   崩溃自愈(KeepAlive) + 登录自启(RunAtLoad)，与防休眠分立"
    echo ""
    echo "常用命令："
    echo "   状态: launchctl print $DOMAIN/${LABEL}"
    echo "   重启: launchctl kickstart -k $DOMAIN/${LABEL}"
    echo "   停止: launchctl bootout $DOMAIN/${LABEL}"
    echo "   启动: launchctl bootstrap $DOMAIN ${PLIST}"
else
    echo "❌ 部署后服务未进入 running 或进程未起，请检查 $LOG_ERR"
    exit 1
fi
