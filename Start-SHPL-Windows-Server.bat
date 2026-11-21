@echo off
SETLOCAL EnableDelayedExpansion
TITLE SHPL — Saptari Hospital Pvt Ltd (1-PC Windows Server + Wi-Fi LAN Host)
cd /d "%~dp0"

echo ============================================================================
echo   SHPL - Saptari Hospital Pvt Ltd Clinical ERP (Windows PC Main Server)
echo   Engineered & Developed by Dr. Santosh Majhi
echo ============================================================================
echo.

where node >nul 2>nul
if ERRORLEVEL 1 (
  echo [ERROR] Node.js v20+ is not installed on this Windows PC.
  echo Please install Node.js LTS from https://nodejs.org/ and re-run this script.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [1/4] Installing Node.js dependencies (first run)...
  call npm install
)

if not exist "dist\index.html" (
  echo [2/4] Building SHPL production frontend & PWA bundle...
  call npm run build
)

echo [3/4] Allowing TCP Port 3000 in Windows Firewall for Same-Wi-Fi LAN Access...
netsh advfirewall firewall show rule name="SHPL Hospital ERP Server" >nul 2>nul
if ERRORLEVEL 1 (
  netsh advfirewall firewall add rule name="SHPL Hospital ERP Server" dir=in action=allow protocol=TCP localport=3000 >nul 2>nul
)

echo [4/4] Detecting Active Wi-Fi / LAN IPv4 Address(es)...
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /R "IPv4"') do (
  set "RAWIP=%%A"
  set "CLEANIP=!RAWIP: =!"
  echo   ^> Connect Windows / Android / iOS Chrome on same Wi-Fi: http://!CLEANIP!:3000
)
echo   ^> Local Server PC URL: http://localhost:3000
echo.
echo Tip: In Chrome/Edge on Windows, Android, or iOS Safari, open the URL above
echo      and tap "Install SHPL App" (Add to Home Screen / Install Page as App).
echo.

set NODE_ENV=production
set PORT=3000
start "" http://localhost:3000
call npx tsx server.ts
pause
