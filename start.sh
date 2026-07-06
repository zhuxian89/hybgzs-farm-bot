#!/bin/bash
# 安全启动 farm-bot
# 注意：防休眠由独立 launchd 服务负责（见 setup-caffeinate.sh），不再与 bot 绑定。
# 这样 farm-bot 重启/崩溃/停止都不会让 Mac 休眠，远程始终可达。

set -e

# 1. 停止现有 farm-bot 进程
echo "停止现有 farm-bot 进程..."
pkill -f "farm-bot.js" 2>/dev/null || true
sleep 2

# 2. 清理锁文件
echo "清理锁文件..."
rm -f data/farm-watch.lock
mkdir -p logs data

# 3. 确认进程已停止
if ps aux | grep -E "node.*farm-bot" | grep -v grep > /dev/null; then
    echo "错误：仍有 farm-bot 进程在运行"
    ps aux | grep -E "node.*farm-bot" | grep -v grep
    exit 1
fi

# 4. 启动 farm-bot（防休眠不在此处，由独立 caffeinate 服务保证 Mac 不睡）
echo "启动 farm-bot..."
nohup node scripts/farm-bot.js --watch > logs/farm-watch.log 2> logs/farm-watch.err.log &

sleep 3

# 5. 验证主进程
echo "验证启动状态..."
MAIN_PROCESSES=$(ps aux | grep -E "node.*farm-bot" | grep -v grep | wc -l | tr -d ' ')
echo "主进程数: $MAIN_PROCESSES"

if [ "$MAIN_PROCESSES" -ne 1 ]; then
    echo "❌ 错误：主进程数量不正确（期望1个，实际${MAIN_PROCESSES}个）"
    ps aux | grep -E "node.*farm-bot" | grep -v grep
    exit 1
fi

MAIN_PID=$(ps aux | grep -E "node.*farm-bot" | grep -v grep | awk '{print $2}')

# 6. 检查防休眠服务（仅提示，不阻断启动）
if pgrep -f "caffeinate -dimsu" > /dev/null 2>&1; then
    echo "✅ 启动成功"
    echo "   主进程: PID $MAIN_PID"
    echo "   防休眠: ✅ 独立 caffeinate 运行中（与 bot 解耦）"
else
    echo "✅ farm-bot 启动成功 (PID $MAIN_PID)"
    echo "   ⚠️  防休眠未运行！Mac 可能休眠导致远程断连"
    echo "   请执行: ./setup-caffeinate.sh"
fi
