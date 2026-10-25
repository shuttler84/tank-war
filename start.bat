@echo off
chcp 65001 >nul 2>nul
setlocal
cd /d "%~dp0"

if not exist "index.html" (
  echo [错误] 当前目录下未找到 index.html
  echo 请确认 start.bat 与 index.html 位于同一目录。
  pause
  exit /b 1
)

echo 正在启动 坦克动荡：本地版 ...
start "" "index.html"

endlocal
exit /b 0
