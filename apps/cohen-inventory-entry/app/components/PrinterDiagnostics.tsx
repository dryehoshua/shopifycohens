import { useCallback, useEffect, useState } from "react";
import {
  getLocalPrinterHealth,
  printLocalDocument,
  printerTestDocument,
  STAR_FUTUREPRNT_URL,
  type LocalPrinterHealth,
} from "../printer-bridge";

type DiagnosticState = "loading" | "ready" | "driver-missing" | "bridge-missing" | "printing" | "printed" | "error";

export function PrinterDiagnostics() {
  const [health, setHealth] = useState<LocalPrinterHealth | null>(null);
  const [state, setState] = useState<DiagnosticState>("loading");
  const [message, setMessage] = useState("Consultando la impresora conectada a esta computadora…");

  const refresh = useCallback(async () => {
    setState("loading");
    setMessage("Consultando la impresora conectada a esta computadora…");
    try {
      const nextHealth = await getLocalPrinterHealth();
      setHealth(nextHealth);
      if (nextHealth.driverReady) {
        setState("ready");
        setMessage("La cola de Windows y el controlador Star están listos.");
      } else if (nextHealth.hardwareDetected) {
        setState("driver-missing");
        setMessage("Windows detecta la Star, pero falta instalar el controlador futurePRNT.");
      } else {
        setState("error");
        setMessage("No se detectó una impresora Star TSP100 conectada.");
      }
    } catch (error) {
      setHealth(null);
      setState("bridge-missing");
      setMessage(error instanceof Error && error.name !== "AbortError"
        ? error.message
        : "El puente local necesita actualizarse para probar la impresora.");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function printTest() {
    setState("printing");
    setMessage("Enviando el ticket de prueba a la Star…");
    try {
      const result = await printLocalDocument(printerTestDocument());
      setState("printed");
      setMessage(`Ticket enviado a ${result.printer?.name || "la impresora Star"}. Revisa el papel y el corte.`);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "No se pudo imprimir la prueba.");
    }
  }

  const printer = health?.printer;
  return <section className="retail-printer-diagnostic" aria-label="Diagnóstico de impresora">
    <div className="retail-printer-hero">
      <div><span className="retail-kicker">IMPRESORA DE TICKETS</span><h2>Prueba de la Star TSP100</h2><p>Comprueba hardware, controlador y salida física sin crear una venta ni modificar Shopify.</p></div>
      <span className={`retail-printer-state ${state}`}>{state === "ready" || state === "printed" ? "LISTA" : state === "printing" || state === "loading" ? "REVISANDO" : "ATENCIÓN"}</span>
    </div>

    <div className="retail-printer-checks">
      <article className={health?.hardwareDetected ? "pass" : "pending"}><b>1</b><span><strong>Hardware USB</strong><small>{health?.hardwareDetected ? `${printer?.portDescription || "Star TSP100"} · ${printer?.portName || "USB"}` : "Conecta y enciende la Star"}</small></span><em>{health?.hardwareDetected ? "Detectada" : "Pendiente"}</em></article>
      <article className={health?.driverReady ? "pass" : "pending"}><b>2</b><span><strong>Controlador Windows</strong><small>{printer?.driverName || "futurePRNT requerido"}</small></span><em>{health?.driverReady ? "Correcto" : "Falta"}</em></article>
      <article className={state === "printed" ? "pass" : "pending"}><b>3</b><span><strong>Ticket físico</strong><small>Formato Cohen&apos;s · sin registrar venta</small></span><em>{state === "printed" ? "Enviado" : "Sin probar"}</em></article>
    </div>

    <div className={`retail-printer-message ${state}`}>{message}</div>

    {!health?.driverReady && health?.hardwareDetected ? <div className="retail-printer-driver">
      <strong>Se requiere Star TSP100 futurePRNT</strong>
      <p>La cola genérica no controla correctamente este modelo. Instala el paquete oficial y después pulsa “Actualizar diagnóstico”.</p>
      <a href={STAR_FUTUREPRNT_URL} target="_blank" rel="noreferrer">Abrir controlador oficial Star ↗</a>
    </div> : null}

    <div className="retail-printer-actions">
      <button type="button" onClick={() => void refresh()} disabled={state === "loading" || state === "printing"}>Actualizar diagnóstico</button>
      <button type="button" className="primary" onClick={() => void printTest()} disabled={!health?.driverReady || state === "printing"}>{state === "printing" ? "Imprimiendo…" : "Imprimir ticket de prueba"}</button>
    </div>

    <small className="retail-printer-note">Esta caja trabaja en Chrome sobre Windows. El módulo de impresión de Shopify sólo aplica dentro de una extensión ejecutada por la app Shopify POS.</small>
  </section>;
}
