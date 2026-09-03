import { NEKUDOT_NFC_BRIDGE_URL } from "./nfc-bridge";

export const STAR_FUTUREPRNT_URL = "https://starmicronics.com/support/download/tsp100-futureprnt-software-lite/";

export type LocalPrinterHealth = {
  ok: boolean;
  platform: string;
  hardwareDetected: boolean;
  driverReady: boolean;
  printer: {
    name: string;
    driverName: string;
    portName: string;
    portDescription: string;
    status: string;
  } | null;
  error?: string | null;
};

export type LocalPrinterLine = {
  text: string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  size?: number;
  spaceAfter?: number;
};

export type LocalPrinterDocument = {
  title: string;
  lines: LocalPrinterLine[];
};

async function printerBridgeFetch(path: string, init?: RequestInit, timeoutMs = 6_000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${NEKUDOT_NFC_BRIDGE_URL}${path}`, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function getLocalPrinterHealth() {
  const response = await printerBridgeFetch("/printer/health", undefined, 15_000);
  const body = await response.json() as LocalPrinterHealth;
  if (!response.ok) throw new Error(body.error || "No se pudo consultar la impresora local.");
  return body;
}

export async function printLocalDocument(document: LocalPrinterDocument) {
  const response = await printerBridgeFetch("/printer/print", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(document),
  }, 15_000);
  const body = await response.json() as { ok?: boolean; printer?: LocalPrinterHealth["printer"]; job?: string; error?: string };
  if (!response.ok || !body.ok) throw new Error(body.error || "Windows no aceptó el trabajo de impresión.");
  return body;
}

export function printerTestDocument(): LocalPrinterDocument {
  return {
    title: "COHENS - PRUEBA DE IMPRESORA - NO ES VENTA",
    lines: [
      { text: "COHEN'S KOSHER & DELI", align: "center", bold: true, size: 13, spaceAfter: 3 },
      { text: "PRUEBA DE IMPRESORA", align: "center", bold: true, size: 11 },
      { text: "NO ES UNA VENTA", align: "center", bold: true, size: 10, spaceAfter: 5 },
      { text: "--------------------------------", align: "center" },
      { text: "1 x Churritos (prueba)" },
      { text: "  $12.00                  $12.00" },
      { text: "--------------------------------", align: "center" },
      { text: "Articulos                  $12.00" },
      { text: "IVA incluido                $1.66" },
      { text: "TOTAL                      $12.00", bold: true, size: 12, spaceAfter: 3 },
      { text: "Pago                     Efectivo" },
      { text: "Recibido                   $20.00" },
      { text: "Cambio                       $8.00" },
      { text: "--------------------------------", align: "center" },
      { text: "Formato de ticket POS", align: "center", bold: true },
      { text: "*** NO ES COMPROBANTE ***", align: "center", spaceAfter: 12 },
    ],
  };
}
