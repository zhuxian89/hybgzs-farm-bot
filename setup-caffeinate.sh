#!/bin/bash
# 部署独立的防休眠服务（launchd 托管 caffeinate）
# 特性：开机自启 + 进程崩溃自动重启 + 与 farm-bot 完全解耦
# 这样 farm-bot 重启/崩溃/停止都不会让 Mac 休眠，远程始终可达。
# 部署一次即可，Mac 重启后自动恢复。

set -e

LABEL="com.hybgzs.caffeinate"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST="$PLIST_DIR/${LABEL}.plist"
BIN="/usr/bin/caffeinate"

mkdir -p "$PLIST_DIR"

# 卸载旧实例（如有）
launchctl unload "$PLIST" 2>/dev/null || true

# 写入 plist
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${BIN}</string>
        <string>-dimsu</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/dev/null</string>
    <key>StandardErrorPath</key>
    <string>/dev/null</string>
</dict>
</plist>
EOF

launchctl load "$PLIST"
sleep 1

if pgrep -f "caffeinate -dimsu" > /dev/null 2>&1; then
    echo "✅ 防休眠服务已部署并运行"
    echo "   配置: $PLIST"
    echo "   特性: 开机自启 + 崩溃自动重启 + 独立于 farm-bot"
    echo "   进程: $(pgrep -lf 'caffeinate -dimsu')"
    echo ""
    echo "卸载方法: launchctl unload \"$PLIST\""
else
    echo "❌ 部署失败，请检查 $PLIST"
    exit 1
fi
