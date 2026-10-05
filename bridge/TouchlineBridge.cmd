@echo off
REM ---------------------------------------------------------------------------
REM  TouchlineOS bridge launcher.
REM
REM  Double-click this. It checks Node is present, refuses to start a second copy
REM  if one is already running, and starts the bridge with its window left open -
REM  the pairing code is printed there and you have to be able to read it.
REM ---------------------------------------------------------------------------
setlocal
set PORT=4977
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

REM Already running? Then there is nothing to do, and starting a second one would
REM only fail on the port.
powershell -NoProfile -Command "try { (New-Object Net.Sockets.TcpClient('127.0.0.1', %PORT%)).Close(); exit 0 } catch { exit 1 }" >nul 2>nul
if %errorlevel%==0 goto already

echo.
echo   Starting the TouchlineOS bridge...
echo.
node "touchline-bridge.mjs"
echo.
echo   The bridge has stopped.
pause
exit /b 0

:already
echo.
echo   The TouchlineOS bridge is already running on port %PORT%.
echo   Nothing to do - the website can already reach it.
echo.
pause
exit /b 0

:nonode
echo.
echo   Node.js is required and was not found on this computer.
echo.
echo   Install the LTS version from https://nodejs.org and run this again.
echo   Nothing else needs installing - this is the only requirement.
echo.
pause
exit /b 1
