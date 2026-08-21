@echo off
rem Double-click this to stop Web Design OS. All the real logic lives in
rem stop-windows.ps1 - see scripts/README.md.
title Web Design OS - Stop
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-windows.ps1"
echo(
pause
