#!/usr/bin/env bash
# MindmapAI 一键启动（浏览器版）— 参数与行为详见 scripts/start.mjs
cd "$(dirname "$0")"
exec node scripts/start.mjs "$@"
