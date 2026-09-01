type OrderAttribute = { key: string; value: string };

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
