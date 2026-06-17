#!/bin/bash
# 安全启动 farm-bot

set -e

# 1. 停止现有进程
echo "停止现有进程..."
pkill -f "farm-bot.js" 2>/dev/null || true
sleep 2

# 2. 清理锁文件
echo "清理锁文件..."
rm -f data/farm-watch.lock

# 3. 确认进程已停止
if ps aux | grep -E "node.*farm-bot" | grep -v grep > /dev/null; then
    echo "错误：仍有进程在运行"
    ps aux | grep -E "node.*farm-bot" | grep -v grep
    exit 1
fi

# 4. 启动服务（使用 caffeinate 防止 Mac 休眠）
echo "启动服务（防休眠模式）..."
caffeinate -dimsu nohup node scripts/farm-bot.js --watch > logs/farm-watch.log 2> logs/farm-watch.err.log &

sleep 3

# 5. 严格验证
echo "验证启动状态..."

# 检查主进程（node farm-bot.js，不包含 caffeinate）
MAIN_PROCESSES=$(ps aux | grep -E "node.*farm-bot" | grep -v grep | grep -v caffeinate | wc -l | tr -d ' ')

# 检查防休眠进程
CAFFEINATE_PROCESSES=$(ps aux | grep "caffeinate.*farm-bot" | grep -v grep | wc -l | tr -d ' ')

echo "主进程数: $MAIN_PROCESSES"
echo "防休眠进程数: $CAFFEINATE_PROCESSES"

# 验证结果
if [ "$MAIN_PROCESSES" -ne 1 ]; then
    echo "❌ 错误：主进程数量不正确（期望1个，实际${MAIN_PROCESSES}个）"
    ps aux | grep -E "node.*farm-bot|caffeinate.*farm-bot" | grep -v grep
    exit 1
fi

if [ "$CAFFEINATE_PROCESSES" -ne 1 ]; then
    echo "❌ 错误：防休眠进程未启动（期望1个，实际${CAFFEINATE_PROCESSES}个）"
    ps aux | grep -E "node.*farm-bot|caffeinate.*farm-bot" | grep -v grep
    exit 1
fi

# 获取进程 PID
MAIN_PID=$(ps aux | grep -E "node.*farm-bot" | grep -v grep | grep -v caffeinate | awk '{print $2}')
CAFFEINATE_PID=$(ps aux | grep "caffeinate.*farm-bot" | grep -v grep | awk '{print $2}')

echo "✅ 启动成功"
echo "   主进程: PID $MAIN_PID"
echo "   防休眠: PID $CAFFEINATE_PID"
