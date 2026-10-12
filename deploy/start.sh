#!/usr/bin/env bash
# 生产启动脚本：单进程同时托管前端静态资源(out/) 与后端 API/WebSocket。
set -euo pipefail
cd "$(dirname "$0")/.."
node -e 'if (Number(process.versions.node.split(".")[0]) < 24) { console.error("MeetingOS requires Node 24+"); process.exit(1) }'
export NODE_ENV=production
export PORT="${PORT:-3001}"
export WEB_ROOT="${WEB_ROOT:-out}"
exec node server/api-server.mjs
