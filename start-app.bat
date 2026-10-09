@echo off
setlocal
title Clyma - Climate Prediction Market

rem ===========================================================================
rem  start-app.bat - one-click launcher for the Clyma web app (full stack)
rem
rem    backend  : Next.js API routes (app/api/**)  ->  http://localhost:3000/api/*
rem    frontend : Next.js + React UI               ->  http://localhost:3000
rem
rem  Both are served by the same Next.js process, so one command starts
rem  everything. The browser is opened automatically once the port answers.
rem
rem  Usage:
rem    start-app.bat        dev server with hot reload (default)
rem    start-app.bat prod   production build + serve (npm run build && npm start)
rem
rem  First run installs node_modules and creates .env from .env.example
rem  when either is missing.
rem
rem  One-time on-chain seeding (optional, needs a funded Devnet wallet):
rem    solana airdrop 2
rem    node scripts/setup.mjs
rem ===========================================================================

cd /d "%~dp0"

set "MODE=%~1"
if /i not "%MODE%"=="prod" set "MODE=dev"
set "PORT=3000"
set "URL=http://localhost:%PORT%"

echo.
echo  ===================================================
echo   Clyma - launching the %MODE% server
echo   %CD%
echo  ===================================================
echo.

rem --- [1/4] Node.js -------------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 goto :err_node
for /f "delims=" %%v in ('node -v') do set "NODE_VER=%%v"
echo  [1/4] Node.js %NODE_VER% ............................. OK

rem --- [2/4] Dependencies ---------------------------------------------------------
if exist "node_modules\next\package.json" (
    echo  [2/4] node_modules .................................. OK
) else (
    echo  [2/4] node_modules missing - running npm install, this takes a minute...
    call npm install
    if errorlevel 1 goto :err_npm
)

rem --- [3/4] Environment ----------------------------------------------------------
if exist ".env" (
    echo  [3/4] .env ......................................... OK
) else (
    if exist ".env.example" (
        copy /y ".env.example" ".env" >nul
        echo  [3/4] .env created from .env.example - fill in your keys for prod mode
    ) else (
        echo  [3/4] no .env found - demo mode only
    )
)
call :check_env MONGODB_URI
call :check_env GEMINI_API_KEY

rem --- [4/4] Start ----------------------------------------------------------------
powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', %PORT%); $c.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto :already_up

echo  [4/4] starting next (%MODE%) - press Ctrl+C to stop
echo.

rem Open the browser as soon as the port answers (waits up to 3 minutes).
start "clyma-browser" /b powershell -NoProfile -WindowStyle Hidden -Command "$ok = $false; for ($i = 0; $i -lt 180; $i++) { try { $t = New-Object Net.Sockets.TcpClient; $t.Connect('127.0.0.1', %PORT%); $t.Close(); $ok = $true; break } catch { Start-Sleep -Seconds 1 } }; if ($ok) { Start-Process '%URL%' }"

if /i "%MODE%"=="prod" (
    call npm run build
    if errorlevel 1 goto :err_build
    call npm start
) else (
    call npm run dev
)

echo.
echo  Server stopped.
pause
exit /b 0

rem ===========================================================================
rem  helpers and error handling
rem ===========================================================================

:check_env
if not exist ".env" exit /b 0
findstr /b /c:"%~1=" ".env" >nul 2>&1
if errorlevel 1 echo  [warn] %~1 is not set in .env - related features stay disabled
exit /b 0

:already_up
echo  [4/4] %URL% is already serving - opening it instead of starting a second one.
start "" "%URL%"
echo.
pause
exit /b 0

:err_node
echo.
echo  [ERROR] Node.js was not found on PATH.
echo          Install Node.js 22.13 or newer from https://nodejs.org, then re-run.
echo.
pause
exit /b 1

:err_npm
echo.
echo  [ERROR] npm install failed - fix the errors above and try again.
echo.
pause
exit /b 1

:err_build
echo.
echo  [ERROR] npm run build failed - fix the errors above and try again.
echo.
pause
exit /b 1
