export const NEKUDOT_PROGRAM_KEY = "cohens";
export const CLIENT_CASHBACK_BASIS_POINTS = 500;
export const BROKER_COMMISSION_BASIS_POINTS = 500;

export function normalizeNekudotCredential(value: unknown) {
  const token = String(value ?? "").normalize("NFKC").trim();
  if (token.length < 4 || token.length > 128) {
    throw new Error("El ID debe contener entre 4 y 128 caracteres.");
  }
  if (/\p{C}/u.test(token)) throw new Error("El ID contiene caracteres de control no válidos.");
  if (/^[0-9a-fA-F:-]+$/.test(token)) {
    const compact = token.replace(/[:-]/g, "").toUpperCase();
    if (compact.length >= 4) return compact;
  }
  return token;
}

export function nekudotCredentialLastFour(value: unknown) {
  return normalizeNekudotCredential(value).slice(-4);
}

export function parseNekudotMoney(value: unknown) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) throw new Error("El importe no es válido.");
  const cents = Math.round(Number(normalized) * 100);
  if (cents <= 0) throw new Error("El importe debe ser mayor que cero.");
  if (cents > 100_000_000) throw new Error("El importe excede el límite permitido.");
  return cents;
}

export function safeNekudotOperationKey(value: unknown) {
  const key = String(value ?? "").trim();
  if (!/^[A-Za-z0-9:_-]{16,120}$/.test(key)) throw new Error("La llave de la operación no es válida.");
  return key;
}

export function calculateRateCents(
  purchaseCents: number,
  rateBasisPoints = CLIENT_CASHBACK_BASIS_POINTS,
) {
  if (!Number.isInteger(purchaseCents) || purchaseCents < 0) {
    throw new Error("El importe de compra no es válido.");
  }
  if (!Number.isInteger(rateBasisPoints) || rateBasisPoints < 0 || rateBasisPoints > 10_000) {
    throw new Error("La tasa no es válida.");
  }
  return Math.floor((purchaseCents * rateBasisPoints) / 10_000);
}

export function calculateNekudotPurchase(purchaseCents: number, hasBroker: boolean) {
  return {
    purchaseCents,
    clientEarnedCents: calculateRateCents(purchaseCents, CLIENT_CASHBACK_BASIS_POINTS),
    brokerEarnedCents: hasBroker
      ? calculateRateCents(purchaseCents, BROKER_COMMISSION_BASIS_POINTS)
      : 0,
  };
}

export function calculateNekudotEligiblePurchaseCents(
  currentTotalCents: number,
  refundedPaymentCents: number,
) {
  if (![currentTotalCents, refundedPaymentCents].every(Number.isInteger)) {
    throw new Error("Los importes de compra y devolución no son válidos.");
  }
  if (currentTotalCents < 0 || refundedPaymentCents < 0) {
    throw new Error("Los importes de compra y devolución no pueden ser negativos.");
  }
  return Math.max(0, currentTotalCents - refundedPaymentCents);
}

export function calculateRestoredRedemptionCents(
  redeemedCents: number,
  originalPurchaseCents: number,
  remainingPurchaseCents: number,
) {
  if (![redeemedCents, originalPurchaseCents, remainingPurchaseCents].every(Number.isInteger)) {
    throw new Error("Los importes del canje no son válidos.");
  }
  if (redeemedCents < 0 || originalPurchaseCents < 0 || remainingPurchaseCents < 0) {
    throw new Error("Los importes del canje no pueden ser negativos.");
  }
  if (!originalPurchaseCents) return redeemedCents;
  const remaining = Math.min(originalPurchaseCents, remainingPurchaseCents);
  const stillApplied = Math.floor((redeemedCents * remaining) / originalPurchaseCents);
  return redeemedCents - stillApplied;
}

export function normalizeBrokerCode(value: unknown) {
  const code = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  if (code.length < 2) throw new Error("El código del broker debe tener al menos 2 caracteres.");
  return code;
}

export function formatNekudot(cents: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}
