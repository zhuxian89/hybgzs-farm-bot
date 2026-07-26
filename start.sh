#!/bin/bash
# 在 launchd 下（重启）farm-bot。
# bot 由 com.hybgzs.farm-bot（KeepAlive）托管，本脚本等同于 launchctl kickstart -k。
# 首次部署请先运行：./setup-farm-bot.sh
# 防休眠由独立服务 com.hybgzs.caffeinate 负责，与本脚本无关。

set -e

LABEL="com.hybgzs.farm-bot"
DOMAIN="gui/$(id -u)"

# 服务未注册则提示先部署
if ! launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    echo "⚠️  $LABEL 未注册。首次请先运行：./setup-farm-bot.sh"
    exit 1
fi

# 在 launchd 下重启 bot（-k：先杀当前实例再立即重启）
launchctl kickstart -k "$DOMAIN/$LABEL"
sleep 2

PID="$(pgrep -f 'node.*farm-bot.js --watch' | head -1)"
if [ -n "$PID" ]; then
    echo "✅ farm-bot 已在 launchd 下重启，PID $PID"
    echo "   状态: launchctl print $DOMAIN/$LABEL"
    echo "   日志: tail -f logs/farm-watch.log"
else
    echo "❌ 重启后未发现进程，请检查 launchctl print $DOMAIN/$LABEL 与 logs/farm-watch.err.log"
    exit 1
fi

# 防休眠提示（非阻断）
if pgrep -f "caffeinate -dimsu" >/dev/null 2>&1; then
    echo "   防休眠: ✅ caffeinate 运行中"
else
    echo "   ⚠️  防休眠未运行，请运行：./setup-caffeinate.sh"
fi
