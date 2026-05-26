@echo off
:: Wrapper .bat pour lancer RAINCORD-uninstall.ps1 facilement (double-clic)
title RAINCORD — Désinstallation
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0RAINCORD-uninstall.ps1"
if %errorlevel% neq 0 pause
