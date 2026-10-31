@echo off
rem Starts CareChain locally: chain (8546), backend (4001), UI (5180), then opens the browser.
rem Uses ports that do not clash with common defaults (8545 / 4000 / 5173).
setlocal
set "ROOT=%~dp0implementation"
set "RPC_URL=http://127.0.0.1:8546"

echo Starting local chain on 8546 ...
start "CareChain chain" /min cmd /c "cd /d %ROOT% && npx hardhat node --port 8546"
timeout /t 10 /nobreak >nul

echo Deploying contracts and seeding demo users ...
cd /d "%ROOT%"
call npm run seed:local
if errorlevel 1 (
  echo Seeding failed - is port 8546 already in use? Run stop-carechain.cmd and try again.
  pause
  exit /b 1
)

set "PORT=4001"
echo Starting backend on 4001 ...
start "CareChain backend" /min cmd /c "cd /d %ROOT% && node backend\src\index.js"

set "BACKEND_URL=http://localhost:4001"
echo Starting UI on 5180 ...
start "CareChain UI" /min cmd /c "cd /d %ROOT%\frontend && npx vite --port 5180 --strictPort"
timeout /t 8 /nobreak >nul

echo.
echo CareChain is running:  http://localhost:5180   (demo password: password123)
start "" http://localhost:5180
endlocal
