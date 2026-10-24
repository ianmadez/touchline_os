@echo off
REM ---------------------------------------------------------------------------
REM  TouchlineOS bridge launcher.
REM
REM  Double-click this. It checks Node is present, refuses to start a second copy
REM  if one is already running, and starts the core with its window left open.
REM
REM  WHAT IT IS. One program, the core: the career database in
REM  %LOCALAPPDATA%\TouchlineOS, the save watcher that hands the website your save,
REM  and - only when you ask for it - the listener a paired phone opens.
REM
REM  PHONE PAIRING IS OFF UNLESS YOU ASK FOR IT. Nothing opens a port on your
REM  network on a double-click. When you want your phone, run this with `share`:
REM
REM      TouchlineBridge.cmd share
REM
REM  That prints the pairing code and a QR code for the phone to scan.
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

REM The one file that ties the pairing code to an address the core prints, so it only ever
REM passes it a switch this core understands. Anything else is ignored rather than forwarded.
set SHARE=
if /i "%~1"=="share" set SHARE=--share
if /i "%~1"=="--share" set SHARE=--share
if /i "%~1"=="pair" set SHARE=--share

REM The downloaded zip: the core is beside this file, and there is no app build, so the
REM core fetches the app from the website the first time a phone asks for it.
if exist "touchline-core.mjs" goto frombundle

REM The project this file came from: `bridge\` sits inside it.
if exist "%~dp0..\package.json" goto fromcheckout
if exist "%~dp0..\..\package.json" goto fromcheckout

echo.
echo   This launcher needs the core beside it, and neither touchline-core.mjs nor the
echo   project folder was found. Unzip the download somewhere and run it from there.
echo.
pause
exit /b 1

:frombundle
echo.
echo   Starting the TouchlineOS core...
if defined SHARE echo   Phone pairing is on. Scan the code below with your phone.
if not defined SHARE echo   Phone pairing is off. Run "TouchlineBridge.cmd share" when you want your phone.
echo.
node "touchline-core.mjs" %SHARE%
goto stopped

:fromcheckout
echo.
echo   Starting the TouchlineOS core from the project...
if defined SHARE echo   Phone pairing is on. Scan the code below with your phone.
if not defined SHARE echo   Phone pairing is off. Run "TouchlineBridge.cmd share" when you want your phone.
echo.
cd /d "%~dp0.."
REM The variable rather than `npm run core -- --share`: npm can treat an unknown flag as its own
REM configuration and start the core with sharing silently off.
if defined SHARE set TOUCHLINE_REMOTE=1
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

:nonode
echo.
echo   Node.js is required and was not found on this computer.
echo.
echo   Install the LTS version from https://nodejs.org and run this again.
echo   Nothing else needs installing - this is the only requirement.
echo.
pause
exit /b 1
