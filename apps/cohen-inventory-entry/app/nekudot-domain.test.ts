import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateNekudotPurchase,
  calculateRateCents,
  calculateRestoredRedemptionCents,
  normalizeNekudotCredential,
  normalizeBrokerCode,
  parseNekudotMoney,
  safeNekudotOperationKey,
} from "./nekudot-domain.ts";

test("acredita 5% al cliente y 5% al broker", () => {
  assert.deepEqual(calculateNekudotPurchase(12_345, true), {
    purchaseCents: 12_345,
    clientEarnedCents: 617,
    brokerEarnedCents: 617,
  });
  assert.equal(calculateRateCents(100), 5);
});

test("no genera comisión cuando el cliente no tiene broker", () => {
  assert.equal(calculateNekudotPurchase(10_000, false).brokerEarnedCents, 0);
});

test("normaliza códigos de broker", () => {
  assert.equal(normalizeBrokerCode(" josé cohen 01 "), "JOSE-COHEN-01");
  assert.throws(() => normalizeBrokerCode("-"));
});

test("normaliza tarjetas y valida operaciones", () => {
  assert.equal(normalizeNekudotCredential("aa:bb:01:ff"), "AABB01FF");
  assert.equal(parseNekudotMoney("125.50"), 12_550);
  assert.equal(safeNekudotOperationKey("nekudot:123456789"), "nekudot:123456789");
});

test("restituye el canje proporcionalmente en una devolución", () => {
  assert.equal(calculateRestoredRedemptionCents(2_000, 10_000, 7_500), 500);
  assert.equal(calculateRestoredRedemptionCents(2_000, 10_000, 0), 2_000);
});
