import { useEffect, useRef, useState } from "react";
import { NEKUDOT_NFC_BRIDGE_URL, type NfcBridgeHealth } from "../nfc-bridge";
import { NFC_LAUNCH_URL, NfcRecoveryError, reactivateNfcWhenStarted } from "../nfc-recovery";

export function NfcBridgeRecovery({ windows, onRecovered }: { windows: boolean; onRecovered: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const active = useRef(true);
  const operation = useRef(0);
  useEffect(() => { active.current = true; return () => { active.current = false; operation.current++; }; }, []);

  async function waitForBridge(run: number) {
    const deadline = Date.now() + 20000;
    let detected = false;
    let readerError = "";
    while (active.current && operation.current === run && Date.now() < deadline) {
      await new Promise(resolve => window.setTimeout(resolve, 800));
      try {
        const response = await fetch(`${NEKUDOT_NFC_BRIDGE_URL}/health`, { cache: "no-store", signal: AbortSignal.timeout(2000) });
        const health = await response.json() as NfcBridgeHealth;
        if (!active.current || operation.current !== run) return;
        if (response.ok && health.ok && health.bridge === "nekudot-nfc") {
          detected = true;
          readerError = health.error || "";
          if (health.readerConnected && !health.error) {
            setMessage("Puente reactivado · lector listo. Ya puedes iniciar la prueba.");
            onRecovered();
            return;
          }
        }
      } catch { /* The local process can take several seconds to start. */ }
    }
    if (active.current && operation.current === run) {
      setMessage(readerError ? "El lector respondió, pero no pudo leer la tarjeta. Retírala, vuelve a acercarla e inicia la prueba. Si se repite, avisa al encargado." : detected ? "El programa ya está abierto, pero no detecta el lector. Revisa que su cable USB esté conectado y pulsa de nuevo." : "Windows no permitió conectar con el lector. Acepta la apertura de Cohens NFC o pide al encargado revisar el permiso de red local.");
    }
  }

  async function recover() {
    if (busy) return;
    // Start from the user click, before asynchronous requests lose user activation.
    if (windows) window.location.href = NFC_LAUNCH_URL;
    const run = ++operation.current;
    setBusy(true);
    setMessage(windows ? "Abriendo y recuperando el lector… Si Windows pregunta, acepta abrir Cohens NFC." : "Recuperando el lector NFC…");
    try {
      await reactivateNfcWhenStarted(fetch, undefined, () => active.current && operation.current === run);
      await waitForBridge(run);
    } catch (error) {
      if (active.current && operation.current === run) {
        setMessage(error instanceof NfcRecoveryError ? error.message : "No se completó la recuperación. Vuelve a intentar.");
      }
    } finally { if (active.current && operation.current === run) setBusy(false); }
  }

  return <div className="nfc-install-card">
    <div className="nfc-install-copy">
      <strong>Reactivar puente NFC</strong>
      <small>Un solo botón abre el programa si está apagado y recupera el lector. No recarga el POS ni crea ventas.</small>
    </div>
    <div className="nfc-install-actions">
      <button type="button" disabled={busy} onClick={() => void recover()}>{busy ? "Reactivando…" : "Reactivar puente"}</button>
    </div>
    <small role="status" aria-live="polite">{message || "Si el lector deja de responder, pulsa Reactivar puente."}</small>
    {windows ? <small>Si el navegador pregunta «¿Abrir Cohens NFC?», elige Abrir. No necesitas buscar ningún programa.</small> : null}
  </div>;
}
