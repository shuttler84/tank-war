@echo off
setlocal
cd /d "%~dp0"

if not exist "index.html" (
  echo [ERROR] index.html not found in current directory.
  pause
  exit /b 1
)

rem 3D view needs a local HTTP server: browsers block ES modules,
rem importmap, GLB model loading under file:// (CORS policy).
rem With Python: start server and open 3D version.
rem Without: fall back to original 2D version.

set PORT=8080
set PY=
python -c "print(1)" >nul 2>nul && set PY=python
if not defined PY py -3 -c "print(1)" >nul 2>nul && set PY=py -3
if not defined PY python3 -c "print(1)" >nul 2>nul && set PY=python3

if defined PY (
  echo Starting Tank Turmoil 3D ...
  echo Local server: http://127.0.0.1:%PORT%/index.html
  echo Close the minimized "tank-server" window to stop the server.
  start "tank-server" /min cmd /c "%PY% -m http.server %PORT% --bind 127.0.0.1"
  %SystemRoot%\System32\timeout.exe /t 2 /nobreak >nul
  start "" "http://127.0.0.1:%PORT%/index.html"
) else (
  echo Python not found. Opening original 2D version via file://
  echo For 3D view: install Python 3 and run this script again,
  echo or run:  python -m http.server 8080
  echo then open  http://127.0.0.1:8080/index.html
  pause
  start "" "index.html"
)

endlocal
exit /b 0
