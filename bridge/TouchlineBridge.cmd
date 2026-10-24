@echo off
REM ---------------------------------------------------------------------------
REM  TouchlineOS bridge launcher.
REM
REM  Double-click this. It checks Node is present, refuses to start a second copy
REM  if one is already running, and starts the bridge with its window left open -
REM  the pairing code is printed there and you have to be able to read it.
REM
REM  WHAT IT STARTS. Inside the project it starts the core (`--share`, the same
REM  switch as TOUCHLINE_REMOTE=1), which is the current implementation: the save
REM  watcher, the career database in %LOCALAPPDATA%\TouchlineOS, the website it
REM  serves to a paired phone, and the pairing code. Next to a downloaded bundle
REM  it starts the single-file bridge instead, because that is all a download has.
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

REM This file lives in `bridge\`, so the project root is one level up.
if exist "%~dp0..\package.json" goto fromcheckout
if exist "%~dp0..\..\package.json" goto fromcheckout

if not exist "touchline-bridge.mjs" goto nobundle
echo.
echo   Starting the TouchlineOS bridge...
echo.
node "touchline-bridge.mjs"
goto stopped

:fromcheckout
echo.
echo   Starting the TouchlineOS core, with phone pairing on...
echo.
cd /d "%~dp0.."
REM The flag form is deliberately avoided: "npm run core -- --share" can treat the
REM unknown flag as npm's own configuration and start the core with sharing
REM silently off. The variable is the form the runbook tells you to type, so the
REM launcher types exactly that.
set TOUCHLINE_REMOTE=1
call npm run core
goto stopped

:stopped
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

:nobundle
echo.
echo   This launcher needs either the project it came from, or the bundled
echo   touchline-bridge.mjs beside it, and neither is here.
echo.
pause
exit /b 1

:nonode
echo.
echo   Node.js is required and was not found on this computer.
echo.
echo   Install the LTS version from https://nodejs.org and run this again.
echo.
pause
exit /b 1
