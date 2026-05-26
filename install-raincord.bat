@echo off
title RainCord Installer
echo.
echo  ========================================
echo    RainCord - Instalador Rapido
echo  ========================================
echo.

:: Verificar se o dist existe
if not exist "%~dp0dist\desktop\patcher.js" (
    echo [ERRO] Arquivos do RainCord nao encontrados!
    echo        Rode "pnpm build" primeiro.
    pause
    exit /b 1
)

:: Matar Discord
echo [1/3] Fechando Discord...
taskkill /F /IM Discord.exe >nul 2>&1
taskkill /F /IM DiscordPTB.exe >nul 2>&1
taskkill /F /IM DiscordCanary.exe >nul 2>&1
timeout /t 3 /nobreak >nul

:: Rodar o instalador
echo [2/3] Abrindo instalador...
echo        Selecione o Discord e aperte Enter.
echo.

if exist "%~dp0dist\Installer\EquilotlCli.exe" (
    set "EQUICORD_USER_DATA_DIR=%~dp0"
    set "EQUICORD_DIRECTORY=%~dp0dist\desktop"
    set "EQUICORD_DEV_INSTALL=1"
    "%~dp0dist\Installer\EquilotlCli.exe" --install
) else (
    echo [ERRO] EquilotlCli.exe nao encontrado!
    echo        Rode "pnpm inject" uma vez primeiro para baixar.
    pause
    exit /b 1
)

echo.
echo [3/3] Pronto! Abra o Discord normalmente.
echo.
pause
