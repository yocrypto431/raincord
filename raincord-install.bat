@echo off
:: Wrapper .bat pour lancer RAINCORD-install.ps1 facilement (double-clic)
title RAINCORD — Installation
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0RAINCORD-install.ps1"
if %errorlevel% neq 0 pause
