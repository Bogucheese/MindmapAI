@echo off
rem MindmapAI 一键启动（浏览器版）— 参数与行为详见 scripts\start.mjs
where node >nul 2>nul
if errorlevel 1 (
  echo [start] ERROR: 未找到 Node.js，请先安装 https://nodejs.org
  pause
  exit /b 1
)
node "%~dp0scripts\start.mjs" %*
pause
