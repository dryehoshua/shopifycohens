export const NFC_SUPERVISOR_URL = "http://127.0.0.1:17813";
export const NFC_LAUNCH_URL = "cohens-nfc://activate";

export class NfcRecoveryError extends Error {
  canLaunch: boolean;
  retryable: boolean;
  constructor(message: string, canLaunch = false, retryable = canLaunch) { super(message); this.canLaunch = canLaunch; this.retryable = retryable; }
}

export async function reactivateNfcBridge(fetcher: typeof fetch = fetch) {
  let supervisor: Response;
  try {
    supervisor = await fetcher(`${NFC_SUPERVISOR_URL}/`, { cache: "no-store", signal: AbortSignal.timeout(2500) });
  } catch {
    throw new NfcRecoveryError("Windows todavía no abrió el lector. Si aparece una pregunta del navegador, acepta abrir Cohens NFC. Si no aparece, avisa al encargado para revisar el permiso de esta computadora.", true);
  }
  const status = await supervisor.json();
  if (!supervisor.ok || status.watchdog !== "cohens-hardware" || status.version !== 2 || typeof status.recoveryToken !== "string") {
    throw new NfcRecoveryError("El supervisor local necesita la actualización de recuperación manual.");
  }
  const response = await fetcher(`${NFC_SUPERVISOR_URL}/reactivate`, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(6000),
    headers: { "X-Cohens-Recovery": status.recoveryToken },
  });
  if (response.status !== 202) {
    const body = await response.json().catch(() => ({}));
    throw new NfcRecoveryError(body.error || "No se pudo reactivar el puente. Espera unos segundos y vuelve a intentar.", false, response.status === 409);
  }
}

export async function reactivateNfcWhenStarted(
  fetcher: typeof fetch = fetch,
  pause: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
  active: () => boolean = () => true,
) {
  for (let attempt = 0; attempt < 8 && active(); attempt++) {
    try { await reactivateNfcBridge(fetcher); return; }
    catch (error) {
      if (!(error instanceof NfcRecoveryError) || !error.retryable || attempt === 7) throw error;
      await pause(1000);
    }
  }
}
