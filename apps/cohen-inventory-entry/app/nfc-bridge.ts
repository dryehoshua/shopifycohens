export const NEKUDOT_NFC_BRIDGE_URL = "http://127.0.0.1:17812";

export type NfcBridgeHealth = {
  ok: boolean;
  bridge: "nekudot-nfc";
  version: number;
  readerConnected: boolean;
  reader: string | null;
  cardPresent: boolean;
  sequence: number;
  error: string | null;
};

export type NfcBridgeEvent = {
  ok: boolean;
  sequence: number;
  credential: string;
  reader: string | null;
  readAt: string;
};

export function normalizeNfcBridgeCredential(value: unknown) {
  const credential = String(value ?? "").trim().replace(/[:-]/g, "").toUpperCase();
  if (!/^[0-9A-F]{4,64}$/.test(credential) || credential.length % 2 !== 0) {
    throw new Error("El lector devolvió un UID no válido.");
  }
  return credential;
}

export function nfcBridgeEventCredential(event: unknown) {
  if (!event || typeof event !== "object") throw new Error("La respuesta del lector no es válida.");
  return normalizeNfcBridgeCredential((event as { credential?: unknown }).credential);
}
