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
REM
REM  START WITH WINDOWS:   TouchlineBridge.cmd autostart        (save only)
REM                       TouchlineBridge.cmd autostart share  (save and phone)
REM                       TouchlineBridge.cmd autostart off    (stop doing it)
REM  That puts a shortcut in your Startup folder which opens this minimised at
REM  sign-in, without opening a browser tab.
REM ---------------------------------------------------------------------------
setlocal
set PORT=4977
cd /d "%~dp0"

if /i "%~1"=="autostart" goto autostart

where node >nul 2>nul
if errorlevel 1 goto nonode
REM The career database driver needs Node 22 or newer. An older Node fails deep inside it with an
REM error nobody could act on, so it is caught here and said plainly instead.
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" >nul 2>nul
if errorlevel 1 goto oldnode

REM Started by the Startup shortcut: no browser tab at sign-in, and no second copy.
set STARTUP=
if /i "%~1"=="startup" set STARTUP=1
if defined STARTUP set TOUCHLINE_OPEN=0

REM Already running? Then there is nothing to do, and starting a second one would
REM only fail on the port.
powershell -NoProfile -Command "try { (New-Object Net.Sockets.TcpClient('127.0.0.1', %PORT%)).Close(); exit 0 } catch { exit 1 }" >nul 2>nul
if %errorlevel%==0 (
  if defined STARTUP exit /b 0
  goto already
)

REM The one file that ties the pairing code to an address the core prints, so it only ever
REM passes it a switch this core understands. Anything else is ignored rather than forwarded.
set SHARE=
if /i "%~1"=="share" set SHARE=--share
if /i "%~1"=="--share" set SHARE=--share
if /i "%~1"=="pair" set SHARE=--share
if /i "%~2"=="share" set SHARE=--share

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

:autostart
set LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\TouchlineOS Bridge.lnk
if /i "%~2"=="off" goto autostartoff
set STARTARGS=startup
if /i "%~2"=="share" set STARTARGS=startup share
powershell -NoProfile -Command "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:LINK); $s.TargetPath = '%~f0'; $s.Arguments = '%STARTARGS%'; $s.WorkingDirectory = '%~dp0'; $s.WindowStyle = 7; $s.Description = 'TouchlineOS bridge'; $s.Save()"
if errorlevel 1 (
  echo.
  echo   Could not create the Startup shortcut. You can still put a shortcut to this file in
  echo   shell:startup yourself.
  echo.
  pause
  exit /b 1
)
echo.
echo   Done. The bridge now starts minimised every time you sign in to Windows.
if /i "%~2"=="share" echo   Phone pairing will be on when it does.
echo   To stop that, run:  TouchlineBridge.cmd autostart off
echo.
pause
exit /b 0

:autostartoff
if exist "%LINK%" del "%LINK%"
echo.
echo   Done. The bridge no longer starts with Windows.
echo.
pause
exit /b 0

:oldnode
echo.
echo   Your Node.js is too old. TouchlineOS needs Node 22 or newer.
echo.
echo   Install the LTS version from https://nodejs.org and run this again.
echo.
pause
exit /b 1

:nonode
echo.
echo   Node.js is required and was not found on this computer.
echo.
echo   Install the LTS version from https://nodejs.org and run this again.
echo   Nothing else needs installing - this is the only requirement.
echo.
pause
exit /b 1
