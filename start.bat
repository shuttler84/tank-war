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

rem ---------------------------------------------------------------
rem 3D 视图需要本地 HTTP 服务：浏览器禁止 file:// 下的
rem ES Module / importmap / GLB 模型加载（CORS 安全策略）。
rem 有 Python → 起服务打开 3D 版；无 → 回退原版 2D 并提示。
rem ---------------------------------------------------------------
set PORT=8080
set PY=
python -c "print(1)" >nul 2>nul && set PY=python
if not defined PY py -3 -c "print(1)" >nul 2>nul && set PY=py -3
if not defined PY python3 -c "print(1)" >nul 2>nul && set PY=python3

if defined PY (
  echo 正在启动 坦克动荡 3D 版 ...
  echo 本地服务: http://127.0.0.1:%PORT%/index.html
  echo （关闭弹出的 "tank-server" 窗口即退出服务；右上角徽标显示 3D 视图）
  start "tank-server" /min cmd /c "%PY% -m http.server %PORT% --bind 127.0.0.1"
  timeout /t 2 /nobreak >nul
  start "" "http://127.0.0.1:%PORT%/index.html"
) else (
  echo 未检测到 Python，以原版 2D 模式打开（file:// 不支持 3D 模块加载）。
  echo 如需 3D 视图：安装 Python 3 后重新运行本脚本，
  echo 或手动执行:  python -m http.server 8080
  echo 然后浏览器打开  http://127.0.0.1:8080/index.html
  pause
  start "" "index.html"
)

endlocal
exit /b 0
