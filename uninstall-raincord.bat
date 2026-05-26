@echo off
title RainCord Uninstaller
echo.
echo  ========================================
echo    RainCord - Desinstalador
echo  ========================================
echo.

:: Matar Discord
echo [1/2] Fechando Discord...
taskkill /F /IM Discord.exe >nul 2>&1
taskkill /F /IM DiscordPTB.exe >nul 2>&1
taskkill /F /IM DiscordCanary.exe >nul 2>&1
timeout /t 3 /nobreak >nul

:: Rodar o desinstalador
echo [2/2] Removendo RainCord...
echo.

if exist "%~dp0dist\Installer\EquilotlCli.exe" (
    set "EQUICORD_USER_DATA_DIR=%~dp0"
    set "EQUICORD_DIRECTORY=%~dp0dist\desktop"
    set "EQUICORD_DEV_INSTALL=1"
    "%~dp0dist\Installer\EquilotlCli.exe" --uninstall
) else (
    echo [ERRO] EquilotlCli.exe nao encontrado!
    pause
    exit /b 1
)

echo.
echo Pronto! RainCord removido. Abra o Discord normalmente.
echo.
pause
