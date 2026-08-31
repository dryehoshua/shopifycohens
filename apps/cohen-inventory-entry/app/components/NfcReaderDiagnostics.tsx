import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  NEKUDOT_NFC_BRIDGE_URL,
  nfcBridgeEventCredential,
  normalizeNfcBridgeCredential,
  summarizeNfcReaderTest,
  type NfcBridgeEvent,
  type NfcBridgeHealth,
  type NfcReaderTestState,
} from "../nfc-bridge";

type LookupMember = {
  displayName: string;
  email: string | null;
  availableCents: number;
};

type DiagnosticRead = {
  sequence: number;
  credential: string;
  readAt: string;
};

type Props = {
  lookupEndpoint: string;
  locationLabel: string;
};

const REQUIRED_READS = 3;
const MAC_INSTALLER_URL = "/downloads/cohens-nfc-macos.tar.gz";
const WINDOWS_INSTALLER_URL = "/downloads/cohens-nfc-windows.cmd";
const ACS_MAC_DRIVER_URL = "https://www.acs.com.hk/download-driver-unified/13549/acsccid-macosx-bin-1.1.11.1-20240826.zip";
const ACS_WINDOWS_DRIVER_URL = "https://www.acs.com.hk/download-driver-unified/9840/ACS-Unified-MSI-4280.rar";
const ACS_LINUX_DRIVER_URL = "https://www.acs.com.hk/download-driver-unified/14214/acsccid-linux-bin-1.1.11-20240328.zip";
const ACS_DRIVER_PAGE_URL = "https://www.acs.com.hk/en/driver/3/acr122u-usb-nfc-reader/";

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

async function bridgeFetch(path: string, timeoutMs = 2_500) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${NEKUDOT_NFC_BRIDGE_URL}${path}`, {
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

function statusLabel(status: NfcReaderTestState) {
  if (status === "pass") return "Correcto";
  if (status === "fail") return "Revisar";
  return "Pendiente";
}

function formatBalance(cents: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);
}

export function NfcReaderDiagnostics({ lookupEndpoint, locationLabel }: Props) {
  const [health, setHealth] = useState<NfcBridgeHealth | null>(null);
  const [bridgeError, setBridgeError] = useState("");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [reads, setReads] = useState<DiagnosticRead[]>([]);
  const [running, setRunning] = useState(false);
  const [fallbackCredential, setFallbackCredential] = useState("");
  const [keyboardFallbackObserved, setKeyboardFallbackObserved] = useState(false);
  const [computerPlatform, setComputerPlatform] = useState<"mac" | "windows" | "other">("other");
  const [lookup, setLookup] = useState<{ state: "idle" | "loading" | "member" | "unassigned" | "error"; member?: LookupMember; message?: string }>({ state: "idle" });
  const sequenceRef = useRef<number | null>(null);
  const runningRef = useRef(false);
  const lookupRunRef = useRef(0);
  const fallbackInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => {
    const platform = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
    setComputerPlatform(platform.includes("mac") ? "mac" : platform.includes("win") ? "windows" : "other");
  }, []);

  const lookupCredential = useCallback(async (credential: string) => {
    const lookupRun = lookupRunRef.current + 1;
    lookupRunRef.current = lookupRun;
    setLookup({ state: "loading" });
    try {
      const response = await fetch(lookupEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "lookup", credential }),
        cache: "no-store",
      });
      const body = await response.json() as { member?: LookupMember; error?: string };
      if (lookupRunRef.current !== lookupRun) return;
      if (response.ok && body.member) {
        setLookup({ state: "member", member: body.member });
      } else if (response.status === 404 || response.status === 400) {
        setLookup({ state: "unassigned", message: body.error || "La tarjeta todavía no está asignada a un cliente." });
      } else {
        setLookup({ state: "error", message: body.error || "No se pudo consultar Nekudot." });
      }
    } catch (error) {
      if (lookupRunRef.current !== lookupRun) return;
      setLookup({ state: "error", message: error instanceof Error ? error.message : "No se pudo consultar Nekudot." });
    }
  }, [lookupEndpoint]);

  const recordCredential = useCallback((rawCredential: string, sequence: number, readAt: string) => {
    if (!runningRef.current) return;
    const credential = normalizeNfcBridgeCredential(rawCredential);
    const read = { sequence, credential, readAt };
    setReads((current) => {
      if (current.some((item) => item.sequence === read.sequence)) return current;
      const next = [...current, read].slice(-REQUIRED_READS);
      if (next.length >= REQUIRED_READS) {
        runningRef.current = false;
        setRunning(false);
      }
      return next;
    });
    void lookupCredential(credential);
  }, [lookupCredential]);

  useEffect(() => {
    let active = true;
    async function poll() {
      while (active) {
        try {
          const startedAt = performance.now();
          const healthResponse = await bridgeFetch("/health");
          if (!healthResponse.ok) throw new Error("El puente local rechazó la comprobación.");
          const nextHealth = await healthResponse.json() as NfcBridgeHealth;
          if (!active) return;
          setHealth(nextHealth);
          setLatencyMs(Math.max(1, Math.round(performance.now() - startedAt)));
          setBridgeError("");
          if (sequenceRef.current === null) sequenceRef.current = nextHealth.sequence || 0;

          if (nextHealth.readerConnected) {
            const eventResponse = await bridgeFetch(`/events?after=${sequenceRef.current}`);
            if (eventResponse.status !== 204) {
              if (!eventResponse.ok) throw new Error("No se pudo recibir la lectura de prueba.");
              const event = await eventResponse.json() as NfcBridgeEvent;
              sequenceRef.current = event.sequence;
              const credential = nfcBridgeEventCredential(event);
              recordCredential(credential, event.sequence, event.readAt);
            }
          }
        } catch (error) {
          if (!active) return;
          setHealth(null);
          setLatencyMs(null);
          setBridgeError(error instanceof TypeError || error instanceof SyntaxError
            ? "Modo seguro del navegador · esperando lectura por teclado"
            : error instanceof Error ? error.message : "No se pudo conectar con el puente local.");
        }
        await wait(450);
      }
    }
    void poll();
    return () => { active = false; lookupRunRef.current += 1; };
  }, [recordCredential]);

  const summary = useMemo(
    () => summarizeNfcReaderTest(health, reads.map((read) => read.credential), REQUIRED_READS),
    [health, reads],
  );
  const bridgeStatus: NfcReaderTestState = keyboardFallbackObserved ? "pass" : bridgeError ? "pending" : summary.bridge;
  const readerStatus: NfcReaderTestState = keyboardFallbackObserved ? "pass" : summary.reader;
  const testPassed = bridgeStatus === "pass" && readerStatus === "pass" && summary.scans === "pass";
  const readerReady = Boolean(health?.readerConnected) && !bridgeError;

  function startTest() {
    setReads([]);
    setFallbackCredential("");
    setKeyboardFallbackObserved(false);
    setLookup({ state: "idle" });
    sequenceRef.current = health?.sequence || 0;
    runningRef.current = true;
    setRunning(true);
    window.requestAnimationFrame(() => fallbackInputRef.current?.focus());
  }

  function submitFallback(event: React.FormEvent) {
    event.preventDefault();
    if (!running || !fallbackCredential.trim()) return;
    try {
      recordCredential(fallbackCredential, Date.now(), new Date().toISOString());
      setKeyboardFallbackObserved(true);
      setFallbackCredential("");
      window.requestAnimationFrame(() => fallbackInputRef.current?.focus());
    } catch {
      setFallbackCredential("");
    }
  }

  return <section className="nfc-diagnostic" aria-label="Diagnóstico del lector NFC">
    <div className="nfc-diagnostic-hero">
      <div>
        <span className="nfc-diagnostic-kicker">PRUEBA SEGURA · {locationLabel.toUpperCase()}</span>
        <h3>{testPassed ? "Lector aprobado" : running ? "Prueba en curso" : "Comprobar lector NFC"}</h3>
        <p>Esta prueba solo lee el UID y consulta el perfil. No crea ventas ni mueve Nekudot.</p>
      </div>
      <span className={`nfc-diagnostic-result ${testPassed ? "pass" : running ? "running" : "idle"}`}>
        {testPassed ? "APROBADO" : running ? `${reads.length}/${REQUIRED_READS}` : "LISTO"}
      </span>
    </div>

    <div className={`nfc-install-card ${bridgeError ? "recommended" : ""}`}>
      <div className="nfc-install-copy">
        <span className="nfc-diagnostic-kicker">CONFIGURACIÓN DE ESTA COMPUTADORA</span>
        <strong>{bridgeError ? "Falta instalar el puente NFC local" : "Instalador y drivers del ACR122U"}</strong>
        <small>{computerPlatform === "mac"
          ? "Detectamos una Mac. Descarga el instalador, descomprímelo y abre el archivo .command; el lector quedará activo también después de reiniciar."
          : computerPlatform === "windows"
            ? "Detectamos Windows. Descarga y abre el instalador .cmd: configura el puente Cohen's, PC/SC y el inicio automático sin pedir permisos de administrador."
            : "Elige el instalador completo de tu sistema. Windows y Mac incluyen el puente local de la POS y el inicio automático."}</small>
      </div>
      <div className="nfc-install-actions">
        <a className={computerPlatform === "windows" ? "primary" : ""} href={WINDOWS_INSTALLER_URL} download>Instalar en Windows</a>
        <a className={computerPlatform === "mac" ? "primary" : ""} href={MAC_INSTALLER_URL} download>Instalar en Mac</a>
        <a href={ACS_WINDOWS_DRIVER_URL} target="_blank" rel="noreferrer">Driver ACS manual</a>
        <a href={ACS_MAC_DRIVER_URL} target="_blank" rel="noreferrer">Driver macOS</a>
        <a href={ACS_LINUX_DRIVER_URL} target="_blank" rel="noreferrer">Driver Linux</a>
      </div>
      <ol className="nfc-install-steps">
        <li><b>Descarga</b> y abre el instalador de tu sistema.</li>
        <li><b>Conecta</b> el ACR122U directamente al USB.</li>
        <li><b>Vuelve aquí</b> e inicia la prueba de tres lecturas.</li>
      </ol>
      <a className="nfc-driver-source" href={ACS_DRIVER_PAGE_URL} target="_blank" rel="noreferrer">Ver todos los drivers en el sitio oficial de ACS ↗</a>
    </div>

    <div className="nfc-diagnostic-checks">
      <article className={`nfc-check ${bridgeStatus}`}>
        <span>1</span><div><strong>Puente local</strong><small>{bridgeError || (latencyMs ? `Activo · respuesta ${latencyMs} ms` : "Conectando…")}</small></div><b>{statusLabel(bridgeStatus)}</b>
      </article>
      <article className={`nfc-check ${readerStatus}`}>
        <span>2</span><div><strong>Lector físico</strong><small>{keyboardFallbackObserved ? "Lectura recibida por el puente en modo seguro" : health?.readerConnected ? health.reader || "Lector PC/SC conectado" : bridgeError ? "La primera lectura confirmará el ACR122U" : "Conecta el ACR122U por USB"}</small></div><b>{statusLabel(readerStatus)}</b>
      </article>
      <article className={`nfc-check ${summary.scans}`}>
        <span>3</span><div><strong>UID estable</strong><small>{summary.scans === "pass" ? `Mismo ID leído ${REQUIRED_READS} veces` : summary.scans === "fail" ? "Se detectaron IDs distintos; repite con una sola tarjeta" : `${reads.length}/${REQUIRED_READS} lecturas completadas`}</small></div><b>{statusLabel(summary.scans)}</b>
      </article>
    </div>

    <div className={`nfc-test-station ${running ? "running" : ""}`}>
      <span className="nfc-test-rings" aria-hidden="true"><i /><i /><i /></span>
      <div>
        <strong>{running ? "Acerca la misma tarjeta" : testPassed ? "La tarjeta respondió correctamente" : "Listo para iniciar"}</strong>
        <small>{running ? "Retírala después de cada lectura y vuelve a acercarla." : readerReady ? "La prueba solicitará tres lecturas consecutivas." : "También funciona con la entrada segura del puente local."}</small>
      </div>
      <button type="button" disabled={running} onClick={startTest}>{running ? "Leyendo…" : testPassed || reads.length ? "Repetir prueba" : "Iniciar prueba"}</button>
    </div>

    <div className="nfc-read-progress" aria-label={`${reads.length} de ${REQUIRED_READS} lecturas`}>
      {Array.from({ length: REQUIRED_READS }, (_, index) => <span key={index} className={reads[index] ? "complete" : ""}>{reads[index] ? "✓" : index + 1}</span>)}
    </div>

    {running ? <form className="nfc-keyboard-fallback" onSubmit={submitFallback}>
      <label htmlFor="nfc-diagnostic-input">Entrada de prueba</label>
      <input id="nfc-diagnostic-input" ref={fallbackInputRef} value={fallbackCredential} onChange={(event) => setFallbackCredential(event.target.value)} placeholder="Esperando lectura de prueba…" autoComplete="off" />
      <small>Mantén este campo enfocado y no escribas el UID. El puente local lo colocará aquí automáticamente.</small>
    </form> : null}

    {reads.length ? <div className="nfc-read-history">
      <div className="nfc-read-history-head"><strong>Lecturas de esta prueba</strong><span>{summary.stableCredential || "Comparando UID…"}</span></div>
      {reads.map((read, index) => <div key={read.sequence}><span>Lectura {index + 1}</span><code>{read.credential}</code><time>{new Date(read.readAt).toLocaleTimeString("es-MX")}</time></div>)}
    </div> : null}

    {lookup.state !== "idle" ? <div className={`nfc-lookup-result ${lookup.state}`}>
      {lookup.state === "loading" ? <><strong>Consultando Nekudot…</strong><span>Buscando el cliente asignado.</span></> : null}
      {lookup.state === "member" && lookup.member ? <><strong>{lookup.member.displayName}</strong><span>{lookup.member.email || "Cliente identificado"} · {formatBalance(lookup.member.availableCents)} disponibles</span></> : null}
      {lookup.state === "unassigned" ? <><strong>Lector correcto · tarjeta sin asignar</strong><span>Puedes vincular este UID desde Clientes. {lookup.message}</span></> : null}
      {lookup.state === "error" ? <><strong>No se completó la consulta del perfil</strong><span>{lookup.message}</span></> : null}
    </div> : null}

    <div className="nfc-diagnostic-footer">
      <span>Diagnóstico local: <code>127.0.0.1:17812</code></span>
      <a href={NEKUDOT_NFC_BRIDGE_URL} target="_blank" rel="noreferrer">Abrir monitor local</a>
    </div>
  </section>;
}
