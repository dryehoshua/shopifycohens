import assert from "node:assert/strict";
import test from "node:test";
import {
  nekudotPurchaseCentsForSyncedOrder,
  orderWatchdogStart,
  posSaleReferences,
} from "./sales-sync-domain.ts";

test("el watchdog solapa dos minutos desde la última corrida completa", () => {
  assert.equal(
    orderWatchdogStart({
      now: new Date("2026-09-11T18:00:00.000Z"),
      lastCompletedAt: new Date("2026-09-11T17:59:00.000Z"),
    }).toISOString(),
    "2026-09-11T17:57:00.000Z",
  );
});

test("la primera corrida recupera siete días", () => {
  assert.equal(
    orderWatchdogStart({
      now: new Date("2026-09-11T18:00:00.000Z"),
    }).toISOString(),
    "2026-09-04T18:00:00.000Z",
  );
});

test("reconoce las ventas creadas por ambas POS", () => {
  assert.deepEqual(
    posSaleReferences([
      { key: "retail_pos_sale_id", value: " retail-123 " },
      { key: "cafe_pos_sale_id", value: "cafe-456" },
    ]),
    { retailSaleId: "retail-123", cafeSaleId: "cafe-456" },
  );
});

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
