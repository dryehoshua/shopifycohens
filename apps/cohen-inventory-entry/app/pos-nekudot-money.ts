import { parseNekudotMoney } from "./nekudot-domain.ts";

/**
 * POS clients serialize an unused redemption as `0.00`. Treat every valid
 * zero representation as "no redemption" while keeping the strict positive
 * amount validation for actual redemptions.
 */
export function parseOptionalNekudotMoney(value: unknown) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!normalized || /^0+(?:\.0{1,2})?$/.test(normalized)) return 0;
  return parseNekudotMoney(normalized);
}
