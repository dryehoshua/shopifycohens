#requires -version 5.1

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$BaseUrl = "https://cohens-operations-production.up.railway.app"
$NodeReleaseUrl = "https://nodejs.org/download/release/latest-v22.x"
$ReaderSourceSha256 = "515235EC761C6A06C54429B87CF602D2DD0CF61D7536EB4E332284EE80F4594A"
$BridgeScriptSha256 = "B2A511E842F801A6E84DFD1395431AF97D2DED734FF7CB07A5C9A806744561A6"
$AppDirectory = Join-Path $env:LOCALAPPDATA "Cohens\NFC"
$BinDirectory = Join-Path $AppDirectory "bin"
$LogDirectory = Join-Path $AppDirectory "logs"
$NodeExecutable = Join-Path $BinDirectory "node.exe"
$ReaderExecutable = Join-Path $BinDirectory "acr122u-reader.exe"
$BridgeScript = Join-Path $AppDirectory "nekudot-nfc-bridge.mjs"
$LauncherScript = Join-Path $AppDirectory "start-cohens-nfc.ps1"
$TemporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ("cohens-nfc-" + [Guid]::NewGuid().ToString("N"))
$PowerShellExecutable = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"

function Write-Step([int]$Number, [string]$Message) {
  Write-Host ("[{0}/6] {1}" -f $Number, $Message) -ForegroundColor Cyan
}

function Download-File([string]$Url, [string]$Destination) {
  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination
  if (-not (Test-Path -LiteralPath $Destination) -or (Get-Item -LiteralPath $Destination).Length -eq 0) {
    throw "La descarga quedó vacía: $Url"
  }
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor DarkGreen
Write-Host "  COHEN'S NEKUDOT NFC - INSTALADOR PARA WINDOWS" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor DarkGreen
Write-Host ""

if (-not [Environment]::Is64BitOperatingSystem) {
  Write-Host "Este instalador requiere Windows de 64 bits." -ForegroundColor Red
  exit 1
}

New-Item -ItemType Directory -Force -Path $TemporaryDirectory | Out-Null

try {
  Write-Step 1 "Preparando Cohen's NFC para este usuario..."
  New-Item -ItemType Directory -Force -Path $AppDirectory, $BinDirectory, $LogDirectory | Out-Null
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*nekudot-nfc-bridge.mjs*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 500

  Write-Step 2 "Descargando Node.js oficial y verificando su firma SHA-256..."
  $WindowsArchitecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  $NodePlatform = if ($WindowsArchitecture -eq "ARM64") { "win-arm64" } else { "win-x64" }
  $ChecksumFile = Join-Path $TemporaryDirectory "SHASUMS256.txt"
  Download-File "$NodeReleaseUrl/SHASUMS256.txt" $ChecksumFile
  $ChecksumLine = Get-Content -LiteralPath $ChecksumFile | Where-Object {
    $_ -match ("^[0-9a-f]{64}\s+node-v[0-9.]+-" + [Regex]::Escape($NodePlatform) + "\.zip$")
  } | Select-Object -First 1
  if (-not $ChecksumLine) {
    throw "No se encontró el paquete oficial de Node.js para $NodePlatform."
  }
  if ($ChecksumLine -match "^([0-9a-f]{64})\s+(.+\.zip)$") {
    $ExpectedNodeHash = $Matches[1].ToUpperInvariant()
    $NodeArchiveName = $Matches[2]
  } else {
    throw "El índice oficial de Node.js devolvió un formato inesperado."
  }
  $NodeArchive = Join-Path $TemporaryDirectory $NodeArchiveName
  Download-File "$NodeReleaseUrl/$NodeArchiveName" $NodeArchive
  $ActualNodeHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $NodeArchive).Hash.ToUpperInvariant()
  if ($ActualNodeHash -ne $ExpectedNodeHash) {
    throw "La verificación SHA-256 de Node.js no coincidió. Instalación cancelada."
  }
  $NodeExtractDirectory = Join-Path $TemporaryDirectory "node"
  Expand-Archive -LiteralPath $NodeArchive -DestinationPath $NodeExtractDirectory -Force
  $DownloadedNode = Get-ChildItem -LiteralPath $NodeExtractDirectory -Filter "node.exe" -Recurse | Select-Object -First 1
  if (-not $DownloadedNode) { throw "El paquete oficial no contenía node.exe." }
  Copy-Item -LiteralPath $DownloadedNode.FullName -Destination $NodeExecutable -Force

  Write-Step 3 "Instalando el puente local Cohen's..."
  Download-File `
    "https://raw.githubusercontent.com/dryehoshua/shopifycohens/main/apps/cohen-inventory-entry/scripts/nekudot-nfc-bridge.mjs" `
    $BridgeScript
  $ActualBridgeScriptHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $BridgeScript).Hash.ToUpperInvariant()
  if ($ActualBridgeScriptHash -ne $BridgeScriptSha256) {
    throw "La verificación SHA-256 del puente NFC no coincidió. Instalación cancelada."
  }
  $ReaderSource = Join-Path $TemporaryDirectory "acr122u-reader-windows.cs"
  Download-File "$BaseUrl/downloads/windows/acr122u-reader-windows.cs" $ReaderSource
  $ActualReaderSourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $ReaderSource).Hash.ToUpperInvariant()
  if ($ActualReaderSourceHash -ne $ReaderSourceSha256) {
    throw "La verificación SHA-256 del lector PC/SC no coincidió. Instalación cancelada."
  }

  Write-Step 4 "Compilando el lector PC/SC nativo de Windows..."
  if (Test-Path -LiteralPath $ReaderExecutable) { Remove-Item -LiteralPath $ReaderExecutable -Force }
  $ReaderSourceCode = Get-Content -LiteralPath $ReaderSource -Raw
  Add-Type -TypeDefinition $ReaderSourceCode -Language CSharp -OutputAssembly $ReaderExecutable -OutputType ConsoleApplication
  if (-not (Test-Path -LiteralPath $ReaderExecutable)) {
    throw "Windows no pudo compilar el controlador local del lector."
  }

  $LauncherContents = @'
$ErrorActionPreference = "Stop"
$env:NEKUDOT_NFC_READER_EXECUTABLE = Join-Path $PSScriptRoot "bin\acr122u-reader.exe"
$env:NEKUDOT_NFC_ALLOWED_ORIGINS = "https://cohens-operations-production.up.railway.app"
$env:NEKUDOT_NFC_KEYBOARD_FALLBACK = "1"
& (Join-Path $PSScriptRoot "bin\node.exe") (Join-Path $PSScriptRoot "nekudot-nfc-bridge.mjs") `
  1>> (Join-Path $PSScriptRoot "logs\bridge.log") `
  2>> (Join-Path $PSScriptRoot "logs\bridge-error.log")
'@
  Set-Content -LiteralPath $LauncherScript -Value $LauncherContents -Encoding UTF8

  Write-Step 5 "Activando el lector automáticamente al iniciar Windows..."
  $StartupDirectory = [Environment]::GetFolderPath("Startup")
  $ShortcutPath = Join-Path $StartupDirectory "Cohens Nekudot NFC.lnk"
  $Shell = New-Object -ComObject WScript.Shell
  $Shortcut = $Shell.CreateShortcut($ShortcutPath)
  $Shortcut.TargetPath = $PowerShellExecutable
  $Shortcut.Arguments = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$LauncherScript`""
  $Shortcut.WorkingDirectory = $AppDirectory
  $Shortcut.WindowStyle = 7
  $Shortcut.Description = "Puente local del lector NFC Cohen's Nekudot"
  $Shortcut.Save()

  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*nekudot-nfc-bridge.mjs*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Process -FilePath $PowerShellExecutable -ArgumentList @(
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden",
    "-File", "`"$LauncherScript`""
  ) -WindowStyle Hidden | Out-Null

  Write-Step 6 "Comprobando el puente y el ACR122U..."
  Start-Sleep -Seconds 3
  $Health = $null
  try {
    $Health = Invoke-RestMethod -UseBasicParsing -Uri "http://127.0.0.1:17812/health" -TimeoutSec 4
  } catch {
    $Health = $null
  }

  Write-Host ""
  if ($Health -and $Health.ok) {
    Write-Host "OK - El puente NFC quedó instalado y activo." -ForegroundColor Green
    if ($Health.readerConnected) {
      Write-Host ("OK - Lector detectado: {0}" -f $Health.reader) -ForegroundColor Green
    } else {
      Write-Host "ATENCION - Conecta el ACR122U directamente al USB y pulsa Reintentar en la POS." -ForegroundColor Yellow
      Write-Host "Windows normalmente instala el controlador CCID automáticamente mediante Windows Update." -ForegroundColor Yellow
    }
  } else {
    Write-Host "ATENCION - El puente se instaló, pero todavía no respondió en el puerto 17812." -ForegroundColor Yellow
    Write-Host ("Revisa el registro: {0}" -f (Join-Path $LogDirectory "bridge-error.log")) -ForegroundColor Yellow
  }

  Set-Content -LiteralPath (Join-Path $AppDirectory "installed-version.txt") -Value "1.0.0" -Encoding ASCII
  Start-Process "$BaseUrl/retail-pos"
  Write-Host ""
  Write-Host "Instalación terminada. Abre Lector NFC y realiza tres lecturas de prueba." -ForegroundColor Green
} catch {
  Write-Host ""
  Write-Host ("No se pudo completar la instalación: {0}" -f $_.Exception.Message) -ForegroundColor Red
  Write-Host "Puedes instalar el driver oficial ACS desde el botón Driver Windows de la POS." -ForegroundColor Yellow
  exit 1
} finally {
  if (Test-Path -LiteralPath $TemporaryDirectory) {
    Remove-Item -LiteralPath $TemporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
  }
}
