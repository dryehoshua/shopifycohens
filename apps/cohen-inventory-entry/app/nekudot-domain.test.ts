import assert from "node:assert/strict";
import test from "node:test";
import {
  BLUE_CASHBACK_BASIS_POINTS,
  cashbackBasisPointsForTier,
  calculateNekudotPurchase,
  calculateRateCents,
  calculateRestoredRedemptionCents,
  GOLDEN_CASHBACK_BASIS_POINTS,
  normalizeNekudotCredential,
  normalizeNekudotCardTier,
  normalizeBrokerCode,
  parseNekudotMoney,
  safeNekudotOperationKey,
  SILVER_CASHBACK_BASIS_POINTS,
} from "./nekudot-domain.ts";

test("acredita la tasa de cada tarjeta y conserva 5% para el broker", () => {
  assert.deepEqual(calculateNekudotPurchase(12_345, true, SILVER_CASHBACK_BASIS_POINTS), {
    purchaseCents: 12_345,
    clientEarnedCents: 246,
    brokerEarnedCents: 617,
  });
  assert.equal(calculateNekudotPurchase(12_345, false, BLUE_CASHBACK_BASIS_POINTS).clientEarnedCents, 617);
  assert.equal(calculateNekudotPurchase(12_345, false, GOLDEN_CASHBACK_BASIS_POINTS).clientEarnedCents, 987);
  assert.equal(calculateRateCents(100), 2);
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
  assert.equal(normalizeNekudotCardTier(" blue "), "BLUE");
  assert.equal(cashbackBasisPointsForTier("SILVER"), 200);
  assert.equal(cashbackBasisPointsForTier("GOLDEN"), 800);
  assert.equal(cashbackBasisPointsForTier("VOUCHER"), 0);
  assert.throws(() => normalizeNekudotCardTier("BLACK"));
  assert.equal(parseNekudotMoney("125.50"), 12_550);
  assert.equal(safeNekudotOperationKey("nekudot:123456789"), "nekudot:123456789");
});

test("restituye el canje proporcionalmente en una devolución", () => {
  assert.equal(calculateRestoredRedemptionCents(2_000, 10_000, 7_500), 500);
  assert.equal(calculateRestoredRedemptionCents(2_000, 10_000, 0), 2_000);
});
