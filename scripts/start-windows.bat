@echo off
rem Double-click this to start Web Design OS. All the real logic lives in
rem start-windows.ps1 (PowerShell, which ships with every Windows 10/11
rem install) - see scripts/README.md. This wrapper just launches it and
rem keeps the window open afterward so you can read the result.
title Web Design OS
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-windows.ps1"
echo(
pause
