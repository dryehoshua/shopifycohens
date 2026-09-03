import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "hardware/acr122u-reader.c");
const buildDirectory = resolve(root, "hardware/.build");
const configuredExecutable = process.env.NEKUDOT_NFC_READER_EXECUTABLE?.trim();
const executable = configuredExecutable ? resolve(configuredExecutable) : resolve(buildDirectory, "acr122u-reader");
const port = Number(process.env.NEKUDOT_NFC_PORT || 17812);
const productionOrigin = "https://cohens-operations-production.up.railway.app";
const configuredOrigins = String(process.env.NEKUDOT_NFC_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const exactOrigins = new Set([productionOrigin, ...configuredOrigins]);
const keyboardFallbackEnabled = process.env.NEKUDOT_NFC_KEYBOARD_FALLBACK !== "0";
let lastEventPollAt = 0;

const keyboardFallbackScript = String.raw`
on run argv
  set cardUid to item 1 of argv
  tell application "System Events"
    try
      set frontProcess to first application process whose frontmost is true
      set focusedElement to value of attribute "AXFocusedUIElement" of frontProcess
      set roleName to value of attribute "AXRole" of focusedElement
      if roleName is not "AXTextField" and roleName is not "AXComboBox" then return "ignored"

      set hintText to ""
      try
        set hintText to value of attribute "AXPlaceholderValue" of focusedElement
      end try
      if hintText is missing value then set hintText to ""
      if hintText does not contain "Escanea" and hintText does not contain "Esperando lectura" then return "ignored"

      keystroke "a" using command down
      keystroke cardUid
      key code 36
      return "typed"
    on error
      return "ignored"
    end try
  end tell
end run
`;

const windowsKeyboardFallbackScript = String.raw`
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.Windows.Forms
$element = [System.Windows.Automation.AutomationElement]::FocusedElement
if ($null -eq $element) { Write-Output "ignored"; exit 0 }
$description = @($element.Current.Name, $element.Current.AutomationId, $element.Current.HelpText) -join " "
if ($description -notmatch "(?i)(esperando lectura|escanea|rfid|qr|nekudot|entrada de prueba)") {
  Write-Output "ignored"
  exit 0
}
[System.Windows.Forms.SendKeys]::SendWait($env:COHENS_NFC_UID)
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Write-Output "typed"
`;

const windowsPrinterHealthScript = String.raw`
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$portDescriptions = @{}
Get-PrinterPort -ErrorAction SilentlyContinue | ForEach-Object { $portDescriptions[$_.Name] = [string]$_.Description }
$candidates = @(Get-Printer -ErrorAction Stop | ForEach-Object {
  $description = [string]$portDescriptions[$_.PortName]
  $identity = @($_.Name, $_.DriverName, $_.PortName, $description) -join " "
  if ($identity -match "(?i)(star|tsp100|tsp143)") {
    [pscustomobject]@{
      name = [string]$_.Name
      driverName = [string]$_.DriverName
      portName = [string]$_.PortName
      portDescription = $description
      status = [string]$_.PrinterStatus
      driverReady = ([string]$_.DriverName -notmatch "(?i)^Generic / Text Only$") -and (@($_.Name, $_.DriverName) -join " " -match "(?i)(star|tsp100|tsp143)")
    }
  }
})
$printer = $candidates | Sort-Object @{ Expression = { if ($_.driverReady) { 0 } else { 1 } } }, name | Select-Object -First 1
[pscustomobject]@{
  ok = $true
  platform = "win32"
  hardwareDetected = [bool]$printer
  driverReady = [bool]($printer -and $printer.driverReady)
  printer = $printer
  error = $null
} | ConvertTo-Json -Depth 4 -Compress
`;

const windowsPrinterPrintScript = String.raw`
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
try {
Add-Type -AssemblyName System.Drawing
$payloadText = [Console]::In.ReadToEnd()
$payload = $payloadText | ConvertFrom-Json
if (-not $payload -or -not $payload.lines -or @($payload.lines).Count -eq 0) { throw "El ticket no contiene líneas para imprimir." }

$portDescriptions = @{}
Get-PrinterPort -ErrorAction SilentlyContinue | ForEach-Object { $portDescriptions[$_.Name] = [string]$_.Description }
$printer = Get-Printer -ErrorAction Stop | Where-Object {
  $description = [string]$portDescriptions[$_.PortName]
  $identity = @($_.Name, $_.DriverName, $_.PortName, $description) -join " "
  $driverReady = ([string]$_.DriverName -notmatch "(?i)^Generic / Text Only$") -and (@($_.Name, $_.DriverName) -join " " -match "(?i)(star|tsp100|tsp143)")
  $identity -match "(?i)(star|tsp100|tsp143)" -and $driverReady
} | Select-Object -First 1
if (-not $printer) { throw "Falta instalar el controlador Star TSP100 futurePRNT en Windows." }

$document = New-Object System.Drawing.Printing.PrintDocument
$document.PrinterSettings.PrinterName = [string]$printer.Name
if (-not $document.PrinterSettings.IsValid) { throw "La cola Star no está disponible en Windows." }
$document.DocumentName = if ($payload.title) { [string]$payload.title } else { "COHENS - TICKET" }
$document.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$document.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(6, 6, 6, 6)
$height = [Math]::Max(700, 100 + (@($payload.lines).Count * 34))
$document.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize("Cohens Receipt", 315, $height)

$handler = [System.Drawing.Printing.PrintPageEventHandler]{
  param($sender, $eventArgs)
  $bounds = $eventArgs.MarginBounds
  $y = [single]$bounds.Top
  $brush = [System.Drawing.Brushes]::Black
  foreach ($line in @($payload.lines)) {
    $fontSize = if ($line.size) { [single][Math]::Max(7, [Math]::Min(18, [double]$line.size)) } else { [single]9 }
    $fontStyle = if ($line.bold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
    $font = New-Object System.Drawing.Font("Consolas", $fontSize, $fontStyle, [System.Drawing.GraphicsUnit]::Point)
    $format = New-Object System.Drawing.StringFormat
    $format.Alignment = if ($line.align -eq "center") { [System.Drawing.StringAlignment]::Center } elseif ($line.align -eq "right") { [System.Drawing.StringAlignment]::Far } else { [System.Drawing.StringAlignment]::Near }
    $lineHeight = [single]([Math]::Ceiling($font.GetHeight($eventArgs.Graphics)) + 2)
    $rectangle = New-Object System.Drawing.RectangleF([single]$bounds.Left, $y, [single]$bounds.Width, $lineHeight)
    $eventArgs.Graphics.DrawString([string]$line.text, $font, $brush, $rectangle, $format)
    $extraSpace = if ($line.spaceAfter) { [double]$line.spaceAfter } else { 0 }
    $y += $lineHeight + [single]$extraSpace
    $format.Dispose()
    $font.Dispose()
  }
  $eventArgs.HasMorePages = $false
}
$document.add_PrintPage($handler)
try { $document.Print() } finally { $document.remove_PrintPage($handler); $document.Dispose() }
[pscustomobject]@{
  ok = $true
  job = [string]$payload.title
  printer = [pscustomobject]@{
    name = [string]$printer.Name
    driverName = [string]$printer.DriverName
    portName = [string]$printer.PortName
    portDescription = [string]$portDescriptions[$printer.PortName]
    status = [string]$printer.PrinterStatus
  }
} | ConvertTo-Json -Depth 4 -Compress
} catch {
  [pscustomobject]@{ ok = $false; error = [string]$_.Exception.Message } | ConvertTo-Json -Compress
}
`;

function runWindowsPowerShell(script, input = "") {
  return new Promise((resolvePromise, rejectPromise) => {
    const encodedCommand = Buffer.from(script, "utf16le").toString("base64");
    const child = spawn("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodedCommand,
    ], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGTERM"), 15_000);
    timeout.unref();
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timeout); rejectPromise(error); });
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise(stdout.trim());
      else rejectPromise(new Error(stderr.trim() || stdout.trim() || `PowerShell terminó con código ${code}.`));
    });
    child.stdin.end(input);
  });
}

function readJsonBody(request, maximumBytes = 64 * 1024) {
  return new Promise((resolvePromise, rejectPromise) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > maximumBytes) {
        rejectPromise(new Error("El ticket excede el tamaño permitido."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try { resolvePromise(JSON.parse(body || "{}")); }
      catch { rejectPromise(new Error("El ticket enviado no es JSON válido.")); }
    });
    request.on("error", rejectPromise);
  });
}

function typeIntoFocusedNekudotField(credential) {
  if (!keyboardFallbackEnabled || Date.now() - lastEventPollAt < 1_500) return;
  if (process.platform !== "darwin" && process.platform !== "win32") return;
  const windows = process.platform === "win32";
  const helper = windows
    ? spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", windowsKeyboardFallbackScript], {
        env: { ...process.env, COHENS_NFC_UID: credential },
        stdio: ["ignore", "pipe", "ignore"],
      })
    : spawn("osascript", ["-", credential], { stdio: ["pipe", "pipe", "ignore"] });
  let output = "";
  const timeout = setTimeout(() => helper.kill("SIGTERM"), windows ? 4_000 : 2_000);
  timeout.unref();
  helper.stdout.setEncoding("utf8");
  helper.stdout.on("data", (chunk) => { output += chunk; });
  helper.on("error", () => clearTimeout(timeout));
  helper.on("exit", () => {
    clearTimeout(timeout);
    if (output.trim() === "typed") {
      process.stdout.write("\u21b3 Lectura enviada al campo Nekudot activo.\n");
    }
  });
  if (!windows) helper.stdin.end(keyboardFallbackScript);
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (exactOrigins.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === "http:"
      && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  } catch {
    return false;
  }
}

function cors(request, response) {
  const origin = request.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("Access-Control-Allow-Private-Network", "true");
  response.setHeader("Cache-Control", "no-store");
}

function json(request, response, status, payload) {
  cors(request, response);
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function diagnosticPage() {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nekudot · Lector NFC</title><style>
:root{font-family:Inter,system-ui,sans-serif;color:#183c2c;background:#f3f5f2}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(560px,100%);padding:32px;border:1px solid #dce4de;border-radius:22px;background:white;box-shadow:0 24px 70px #173b2b18}.brand{font-size:12px;font-weight:900;letter-spacing:.14em;color:#317554}h1{margin:10px 0 8px;font-family:Georgia,serif;font-size:34px;font-weight:500}p{color:#65736b;line-height:1.55}.reader{margin:24px 0;padding:22px;border-radius:16px;background:linear-gradient(135deg,#153f2d,#277653);color:white}.status{display:flex;align-items:center;gap:10px}.dot{width:11px;height:11px;border-radius:50%;background:#e4b758;box-shadow:0 0 0 6px #ffffff18}.status.ready .dot{background:#67d493}.uid{margin-top:24px;padding:16px;border:1px dashed #9eb9a9;border-radius:12px;text-align:center}.uid strong{display:block;margin-top:7px;font:800 25px ui-monospace,SFMono-Regular,monospace;letter-spacing:.08em}.muted{font-size:13px}code{padding:2px 5px;border-radius:5px;background:#eef3ef}</style></head>
<body><main class="card"><div class="brand">NEKUDOT COHEN'S · PUENTE LOCAL</div><h1>Prueba del lector NFC</h1><p>Acerca una tarjeta al ACR122U. Solo se leerá su identificador público (UID).</p><section class="reader"><div id="status" class="status"><span class="dot"></span><strong>Conectando con el lector…</strong></div><div class="uid"><span class="muted">Último UID leído</span><strong id="uid">—</strong></div></section><p class="muted">Puedes dejar esta ventana abierta mientras usamos la app de Shopify. Puerto local: <code>${port}</code>.</p></main>
<script>let sequence=0;const status=document.querySelector('#status');const uid=document.querySelector('#uid');async function poll(){try{const health=await fetch('/health').then(r=>r.json());status.className='status '+(health.readerConnected?'ready':'');status.querySelector('strong').textContent=health.readerConnected?health.cardPresent?'Tarjeta presente':'Lector listo · acerca una tarjeta':'Buscando ACR122U…';const response=await fetch('/events?after='+sequence);if(response.status!==204&&response.ok){const event=await response.json();sequence=event.sequence;if(event.credential){uid.textContent=event.credential;status.querySelector('strong').textContent='Tarjeta leída correctamente';}}}catch{status.querySelector('strong').textContent='No se pudo consultar el lector';}setTimeout(poll,500)}poll()</script></body></html>`;
}

if (configuredExecutable) {
  if (!existsSync(executable)) {
    process.stderr.write(`No se encontró el ejecutable configurado del lector: ${executable}\n`);
    process.exit(1);
  }
} else {
  mkdirSync(buildDirectory, { recursive: true });
  const compilation = spawnSync("clang", [source, "-O2", "-Wall", "-Wextra", "-framework", "PCSC", "-o", executable], {
    encoding: "utf8",
  });
  if (compilation.status !== 0) {
    process.stderr.write(compilation.stderr || "No se pudo compilar el lector PC/SC.\n");
    process.exit(compilation.status || 1);
  }
}

const state = {
  readerConnected: false,
  reader: null,
  cardPresent: false,
  sequence: 0,
  lastEvent: null,
  error: null,
};
let readerProcess;
let stopping = false;
let partialLine = "";

function handleReaderMessage(message) {
  if (message.type === "reader") {
    state.readerConnected = message.status === "connected";
    state.reader = message.reader || null;
    if (!state.readerConnected) state.cardPresent = false;
    state.error = null;
    return;
  }
  if (message.type === "card" && message.uid) {
    state.cardPresent = true;
    state.sequence += 1;
    state.lastEvent = {
      sequence: state.sequence,
      credential: message.uid,
      reader: state.reader,
      readAt: new Date().toISOString(),
    };
    state.error = null;
    process.stdout.write(`\n✓ Tarjeta leída: ${message.uid}\n`);
    typeIntoFocusedNekudotField(message.uid);
    return;
  }
  if (message.type === "card" && message.status === "removed") {
    state.cardPresent = false;
    return;
  }
  if (message.type === "error") {
    state.error = message.message || "Error del lector.";
    process.stderr.write(`\nLector: ${state.error} (${message.code || "sin código"})\n`);
  }
}

function startReader() {
  readerProcess = spawn(executable, [], { stdio: ["ignore", "pipe", "pipe"] });
  readerProcess.stdout.setEncoding("utf8");
  readerProcess.stdout.on("data", (chunk) => {
    partialLine += chunk;
    const lines = partialLine.split("\n");
    partialLine = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try { handleReaderMessage(JSON.parse(line)); }
      catch { process.stderr.write(`Mensaje inválido del lector: ${line}\n`); }
    }
  });
  readerProcess.stderr.on("data", (chunk) => process.stderr.write(chunk));
  readerProcess.on("exit", () => {
    state.readerConnected = false;
    state.cardPresent = false;
    if (!stopping) setTimeout(startReader, 1_000).unref();
  });
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (!isAllowedOrigin(origin)) {
    json(request, response, 403, { ok: false, error: "Origen no autorizado para usar el lector NFC." });
    return;
  }
  if (request.method === "OPTIONS") {
    cors(request, response);
    response.writeHead(204);
    response.end();
    return;
  }
  const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
  if (request.method === "GET" && url.pathname === "/") {
    cors(request, response);
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(diagnosticPage());
    return;
  }
  if (request.method === "GET" && url.pathname === "/health") {
    json(request, response, 200, {
      ok: true,
      bridge: "nekudot-nfc",
      version: 1,
      readerConnected: state.readerConnected,
      reader: state.reader,
      cardPresent: state.cardPresent,
      sequence: state.sequence,
      error: state.error,
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/events") {
    // The diagnostic page is same-origin and should not suppress the native
    // fallback used by Shopify's embedded iframe.
    if (origin) lastEventPollAt = Date.now();
    const after = Number(url.searchParams.get("after") || 0);
    if (state.lastEvent && state.lastEvent.sequence > after) {
      json(request, response, 200, { ok: true, ...state.lastEvent });
    } else {
      cors(request, response);
      response.writeHead(204);
      response.end();
    }
    return;
  }
  if (request.method === "GET" && url.pathname === "/printer/health") {
    if (process.platform !== "win32") {
      json(request, response, 200, { ok: true, platform: process.platform, hardwareDetected: false, driverReady: false, printer: null, error: "La impresión local está preparada para Windows." });
      return;
    }
    try {
      const output = await runWindowsPowerShell(windowsPrinterHealthScript);
      json(request, response, 200, JSON.parse(output));
    } catch (error) {
      json(request, response, 500, { ok: false, platform: process.platform, hardwareDetected: false, driverReady: false, printer: null, error: error instanceof Error ? error.message : "No se pudo consultar la impresora." });
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/printer/print") {
    if (process.platform !== "win32") {
      json(request, response, 501, { ok: false, error: "La impresión local está preparada para Windows." });
      return;
    }
    try {
      const document = await readJsonBody(request);
      const output = await runWindowsPowerShell(windowsPrinterPrintScript, JSON.stringify(document));
      const result = JSON.parse(output);
      json(request, response, result.ok ? 200 : 409, result);
    } catch (error) {
      json(request, response, 500, { ok: false, error: error instanceof Error ? error.message : "No se pudo imprimir el ticket." });
    }
    return;
  }
  json(request, response, 404, { ok: false, error: "Ruta no encontrada." });
});

function shutdown() {
  if (stopping) return;
  stopping = true;
  readerProcess?.kill("SIGTERM");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
startReader();
server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Puente NFC Nekudot activo en http://127.0.0.1:${port}\n`);
  process.stdout.write("Acerca una tarjeta al ACR122U para leer su UID.\n");
});
