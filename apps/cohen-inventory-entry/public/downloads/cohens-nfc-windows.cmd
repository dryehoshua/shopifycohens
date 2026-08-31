@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Cohen's Nekudot NFC - Instalador Windows
color 0A

echo.
echo ============================================================
echo   COHEN'S NEKUDOT NFC - PREPARANDO INSTALACION WINDOWS
echo ============================================================
echo.

set "COHENS_NFC_INSTALLER=%TEMP%\cohens-nfc-windows-%RANDOM%-%RANDOM%.ps1"
set "COHENS_NFC_INSTALLER_URL=https://cohens-operations-production.up.railway.app/downloads/windows/install-cohens-nfc-windows.ps1"
set "COHENS_NFC_INSTALLER_SHA256=15D3DB0D520BE874F8BF91B3BCDD3149441BE74947D79074AACA1FAAE6313CEF"

echo Descargando el instalador seguro...
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri $env:COHENS_NFC_INSTALLER_URL -OutFile $env:COHENS_NFC_INSTALLER; $actual=(Get-FileHash -Algorithm SHA256 -LiteralPath $env:COHENS_NFC_INSTALLER).Hash.ToUpperInvariant(); if($actual -ne $env:COHENS_NFC_INSTALLER_SHA256){throw 'La firma SHA-256 del instalador no coincide.'}"
if errorlevel 1 goto download_error

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%COHENS_NFC_INSTALLER%"
set "COHENS_NFC_RESULT=%ERRORLEVEL%"
del /q "%COHENS_NFC_INSTALLER%" >nul 2>&1

if not "%COHENS_NFC_RESULT%"=="0" goto install_error
echo.
echo LISTO. Cohen's NFC quedo instalado para este usuario.
echo La POS se abrira automaticamente para hacer la prueba.
echo.
pause
exit /b 0

:download_error
echo.
echo No se pudo descargar o verificar el instalador.
echo Comprueba la conexion a Internet e intentalo nuevamente.
del /q "%COHENS_NFC_INSTALLER%" >nul 2>&1
echo.
pause
exit /b 1

:install_error
echo.
echo La instalacion no termino correctamente.
echo Lee el mensaje anterior o usa Driver Windows dentro de la POS.
echo.
pause
exit /b %COHENS_NFC_RESULT%
