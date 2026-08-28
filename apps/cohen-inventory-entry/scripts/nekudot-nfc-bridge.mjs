import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, "hardware/acr122u-reader.c");
const buildDirectory = resolve(root, "hardware/.build");
const executable = resolve(buildDirectory, "acr122u-reader");
const port = Number(process.env.NEKUDOT_NFC_PORT || 17812);
const productionOrigin = "https://cohens-operations-production.up.railway.app";
const configuredOrigins = String(process.env.NEKUDOT_NFC_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const exactOrigins = new Set([productionOrigin, ...configuredOrigins]);

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
  response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
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

mkdirSync(buildDirectory, { recursive: true });
const compilation = spawnSync("clang", [source, "-O2", "-Wall", "-Wextra", "-framework", "PCSC", "-o", executable], {
  encoding: "utf8",
});
if (compilation.status !== 0) {
  process.stderr.write(compilation.stderr || "No se pudo compilar el lector PC/SC.\n");
  process.exit(compilation.status || 1);
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

const server = createServer((request, response) => {
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
