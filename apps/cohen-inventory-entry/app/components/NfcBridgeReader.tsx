import { useCallback, useEffect, useRef, useState } from "react";
import {
  NEKUDOT_NFC_BRIDGE_URL,
  nfcBridgeEventCredential,
  type NfcBridgeEvent,
  type NfcBridgeHealth,
} from "../nfc-bridge";

type ReaderState = "connecting" | "ready" | "waiting" | "read" | "disconnected" | "error";

type Props = {
  onCredential: (credential: string) => void;
  compact?: boolean;
  className?: string;
};

async function bridgeFetch(path: string, timeoutMs = 2_000) {
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

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

export function NfcBridgeReader({ onCredential, compact = false, className = "" }: Props) {
  const [state, setState] = useState<ReaderState>("connecting");
  const [readerName, setReaderName] = useState("ACR122U");
  const [lastFour, setLastFour] = useState("");
  const runId = useRef(0);
  const onCredentialRef = useRef(onCredential);

  useEffect(() => { onCredentialRef.current = onCredential; }, [onCredential]);

  const connect = useCallback(async () => {
    const currentRun = runId.current + 1;
    runId.current = currentRun;
    setState("connecting");
    while (runId.current === currentRun) {
      try {
        const healthResponse = await bridgeFetch("/health");
        if (!healthResponse.ok) throw new Error("El puente NFC rechazó la conexión.");
        let health = await healthResponse.json() as NfcBridgeHealth;
        let sequence = health.sequence || 0;
        if (health.reader) setReaderName(health.reader);
        setState(health.readerConnected ? "ready" : "waiting");

        while (runId.current === currentRun) {
          if (!health.readerConnected) {
            await wait(900);
            const nextHealthResponse = await bridgeFetch("/health");
            if (!nextHealthResponse.ok) throw new Error("No se pudo consultar el lector.");
            health = await nextHealthResponse.json() as NfcBridgeHealth;
            if (health.reader) setReaderName(health.reader);
            setState(health.readerConnected ? "ready" : "waiting");
            sequence = Math.max(sequence, health.sequence || 0);
            continue;
          }

          const eventResponse = await bridgeFetch(`/events?after=${sequence}`);
          if (eventResponse.status === 204) {
            await wait(450);
            continue;
          }
          if (!eventResponse.ok) throw new Error("No se pudo recibir la lectura NFC.");
          const event = await eventResponse.json() as NfcBridgeEvent;
          sequence = event.sequence;
          const credential = nfcBridgeEventCredential(event);
          setLastFour(credential.slice(-4));
          setState("read");
          onCredentialRef.current(credential);
          await wait(1_100);
          if (runId.current === currentRun) setState("ready");
        }
      } catch (error) {
        if (runId.current !== currentRun) return;
        setState(error instanceof DOMException && error.name === "AbortError" ? "disconnected" : "error");
        await wait(1_500);
        if (runId.current === currentRun) setState("connecting");
      }
    }
  }, []);

  useEffect(() => {
    void connect();
    const reconnect = () => { if (!document.hidden) void connect(); };
    window.addEventListener("focus", reconnect);
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", reconnect);
    return () => {
      runId.current += 1;
      window.removeEventListener("focus", reconnect);
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", reconnect);
    };
  }, [connect]);

  const labels: Record<ReaderState, string> = {
    connecting: "Conectando lector…",
    ready: "Lector listo · acerca una tarjeta",
    waiting: "Puente activo · buscando ACR122U",
    read: `Tarjeta leída${lastFour ? ` · •••• ${lastFour}` : ""}`,
    disconnected: "Puente NFC no iniciado",
    error: "Lector local en modo seguro",
  };
  const canRetry = state === "disconnected" || state === "error";

  return <div className={`nfc-bridge nfc-${state} ${compact ? "nfc-compact" : ""} ${className}`.trim()} role="status">
    <span className="nfc-signal" aria-hidden="true"><i /><i /><i /></span>
    <span className="nfc-copy"><strong>{labels[state]}</strong>{!compact ? <small>{state === "error" ? "Deja enfocado el campo Nekudot y acerca la tarjeta." : state === "disconnected" ? "Abre el puente local para usar el ACR122U." : readerName}</small> : null}</span>
    {canRetry ? <button type="button" onClick={() => void connect()}>Reintentar</button> : <span className="nfc-dot" aria-hidden="true" />}
  </div>;
}
