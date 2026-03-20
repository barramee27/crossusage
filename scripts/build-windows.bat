@echo off
REM Build OpenUsage for Windows. Run this script on Windows.
REM Output: src-tauri\target\release\bundle\nsis\OpenUsage_*_x64-setup.exe

cd /d "%~dp0\.."

echo Installing dependencies...
call bun install
if errorlevel 1 exit /b 1

echo Bundling plugins...
call bun run bundle:plugins
if errorlevel 1 exit /b 1

echo Building Tauri app...
call bun run tauri build
if errorlevel 1 exit /b 1

echo.
echo Build complete. Output:
dir /b src-tauri\target\release\bundle\nsis\*.exe 2>nul
exit /b 0
