@echo off
setlocal
cd /d "%~dp0fasih-kbli-automation"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js belum terpasang. Instal Node.js LTS lalu jalankan ulang file ini.
  pause
  exit /b 1
)
npm run manual-assist
if errorlevel 1 pause
