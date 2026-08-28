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

export type NfcReaderTestState = "pending" | "pass" | "fail";

export type NfcReaderTestSummary = {
  bridge: NfcReaderTestState;
  reader: NfcReaderTestState;
  scans: NfcReaderTestState;
  stableCredential: string | null;
  passed: boolean;
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

export function summarizeNfcReaderTest(
  health: NfcBridgeHealth | null,
  credentials: string[],
  requiredReads = 3,
): NfcReaderTestSummary {
  const normalized = credentials.map(normalizeNfcBridgeCredential);
  const enoughReads = normalized.length >= requiredReads;
  const testedReads = normalized.slice(0, requiredReads);
  const stableCredential = enoughReads && new Set(testedReads).size === 1 ? testedReads[0] : null;
  const bridge = health ? (health.ok && health.bridge === "nekudot-nfc" ? "pass" : "fail") : "pending";
  const reader = health ? (health.readerConnected ? "pass" : "fail") : "pending";
  const scans = enoughReads ? (stableCredential ? "pass" : "fail") : "pending";

  return {
    bridge,
    reader,
    scans,
    stableCredential,
    passed: bridge === "pass" && reader === "pass" && scans === "pass",
  };
}
