#!/usr/bin/env bash
# scripts/restart-server.sh —— 重启工作台 server（停/清端口/启动/验证）一条龙（2026-08-07）
# 用法：bash scripts/restart-server.sh [PORT]
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1
PORT="${1:-8080}"

# 1. 停旧进程（含 Git Bash 后台残留——踩坑日志 2.4：包装 kill 不杀底层 node）
PID=$(netstat -ano | grep -E ":${PORT}\\s" | grep LISTENING | awk '{print $5}' | head -1 || true)
if [ -n "${PID:-}" ]; then
  taskkill //PID "$PID" //F > /dev/null 2>&1 || true
  echo "已停止旧进程 PID=$PID"
  sleep 1
fi

# 2. 确认端口干净（残留兜底）
if netstat -ano | grep -E ":${PORT}\\s" | grep -q LISTENING; then
  echo "端口 ${PORT} 仍有残留，清理失败"; exit 1
fi

# 3. 启动（脱离终端，日志落 /tmp）
nohup npm run server > /tmp/wb-server.log 2>&1 &
sleep 3

# 4. 验证（端口 + HTTP）
if netstat -ano | grep -E ":${PORT}\\s" | grep -q LISTENING; then
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${PORT}/" || echo 000)
  echo "server OK: HTTP ${CODE} on :${PORT}"
else
  echo "启动失败——检查 /tmp/wb-server.log"; exit 1
fi
