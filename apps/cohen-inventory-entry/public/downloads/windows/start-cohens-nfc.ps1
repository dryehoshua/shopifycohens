#requires -version 5.1

$ErrorActionPreference = "Continue"

$AppDirectory = $PSScriptRoot
$NodeExecutable = Join-Path $AppDirectory "bin\node.exe"
$ReaderExecutable = Join-Path $AppDirectory "bin\acr122u-reader.exe"
$BridgeScript = Join-Path $AppDirectory "nekudot-nfc-bridge.mjs"
$LogDirectory = Join-Path $AppDirectory "logs"
$BridgeLog = Join-Path $LogDirectory "bridge.log"
$BridgeErrorLog = Join-Path $LogDirectory "bridge-error.log"
$WatchdogLog = Join-Path $LogDirectory "watchdog.log"
$MutexName = "Local\CohensNekudotNfcWatchdog"
$RestartDelaySeconds = 2

New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null

function Write-WatchdogLog([string]$Message) {
  $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -LiteralPath $WatchdogLog -Value ("[{0}] {1}" -f $timestamp, $Message) -Encoding UTF8
}

$createdNew = $false
$mutex = [System.Threading.Mutex]::new($true, $MutexName, [ref]$createdNew)
if (-not $createdNew) {
  $mutex.Dispose()
  exit 0
}

try {
  if (-not (Test-Path -LiteralPath $NodeExecutable)) {
    Write-WatchdogLog "No se encontró node.exe; ejecuta nuevamente el instalador."
    exit 1
  }
  if (-not (Test-Path -LiteralPath $ReaderExecutable)) {
    Write-WatchdogLog "No se encontró el lector nativo; ejecuta nuevamente el instalador."
    exit 1
  }
  if (-not (Test-Path -LiteralPath $BridgeScript)) {
    Write-WatchdogLog "No se encontró el puente NFC; ejecuta nuevamente el instalador."
    exit 1
  }

  $env:NEKUDOT_NFC_READER_EXECUTABLE = $ReaderExecutable
  $env:NEKUDOT_NFC_ALLOWED_ORIGINS = "https://cohens-operations-production.up.railway.app"
  $env:NEKUDOT_NFC_KEYBOARD_FALLBACK = "1"

  while ($true) {
    try {
      Write-WatchdogLog "Iniciando puente NFC."
      & $NodeExecutable $BridgeScript 1>> $BridgeLog 2>> $BridgeErrorLog
      Write-WatchdogLog ("El puente terminó con código {0}; se reiniciará." -f $LASTEXITCODE)
    } catch {
      Write-WatchdogLog ("El puente falló: {0}" -f $_.Exception.Message)
    }
    Start-Sleep -Seconds $RestartDelaySeconds
  }
} finally {
  if ($createdNew) {
    try { $mutex.ReleaseMutex() } catch {}
  }
  $mutex.Dispose()
}
