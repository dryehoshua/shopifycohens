import assert from "node:assert/strict";
import test from "node:test";
import { nekudotPurchaseCentsForSyncedOrder } from "./sales-sync-domain.ts";

test("conserva el total pagado con IVA para pedidos del POS de cafetería", () => {
  assert.equal(
    nekudotPurchaseCentsForSyncedOrder({
      currentTotalCents: 12_000,
      lineNetSalesCents: [10_345],
      customAttributes: [{ key: "cafe_pos_sale_id", value: "sale-1044" }],
    }),
    12_000,
  );
});

test("conserva la base neta de Shopify para pedidos ajenos al POS de cafetería", () => {
  assert.equal(
    nekudotPurchaseCentsForSyncedOrder({
      currentTotalCents: 12_000,
      lineNetSalesCents: [5_000, 5_345],
      customAttributes: [],
    }),
    10_345,
  );
});

test("reduce a cero una devolución completa del POS de cafetería", () => {
  assert.equal(
    nekudotPurchaseCentsForSyncedOrder({
      currentTotalCents: 0,
      lineNetSalesCents: [0],
      customAttributes: [{ key: "cafe_pos_sale_id", value: "sale-refunded" }],
    }),
    0,
  );
});
