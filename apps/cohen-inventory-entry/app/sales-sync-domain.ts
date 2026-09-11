type OrderAttribute = { key: string; value: string };

const MINUTE_MS = 60_000;

export function orderWatchdogStart({
  now,
  lastCompletedAt,
  overlapMinutes = 2,
  initialLookbackMinutes = 7 * 24 * 60,
}: {
  now: Date;
  lastCompletedAt?: Date | null;
  overlapMinutes?: number;
  initialLookbackMinutes?: number;
}) {
  const safeOverlapMinutes = Math.max(0, overlapMinutes);
  const safeInitialLookbackMinutes = Math.max(
    safeOverlapMinutes,
    initialLookbackMinutes,
  );
  const anchor = lastCompletedAt ?? now;
  const minutes = lastCompletedAt
    ? safeOverlapMinutes
    : safeInitialLookbackMinutes;

  return new Date(anchor.getTime() - minutes * MINUTE_MS);
}

export function posSaleReferences(customAttributes: OrderAttribute[]) {
  const valueFor = (key: string) =>
    customAttributes
      .find((attribute) => attribute.key === key)
      ?.value.trim() || null;

  return {
    cafeSaleId: valueFor("cafe_pos_sale_id"),
    retailSaleId: valueFor("retail_pos_sale_id"),
  };
}

export function nekudotPurchaseCentsForSyncedOrder({
  currentTotalCents,
  lineNetSalesCents,
  customAttributes,
}: {
  currentTotalCents: number;
  lineNetSalesCents: number[];
  customAttributes: OrderAttribute[];
}) {
  const isCafePosOrder = customAttributes.some(
    (attribute) =>
      attribute.key === "cafe_pos_sale_id" && Boolean(attribute.value.trim()),
  );

  return Math.max(
    0,
    isCafePosOrder
      ? currentTotalCents
      : lineNetSalesCents.reduce((total, amount) => total + Math.max(0, amount), 0),
  );
}
