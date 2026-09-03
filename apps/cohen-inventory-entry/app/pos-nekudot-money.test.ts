import assert from "node:assert/strict";
import test from "node:test";
import { maximumNekudotRedemptionCents, parseOptionalNekudotMoney } from "./pos-nekudot-money.ts";

test("acepta importes POS vacíos y ceros decimales como ningún canje", () => {
  assert.equal(parseOptionalNekudotMoney(undefined), 0);
  assert.equal(parseOptionalNekudotMoney(""), 0);
  assert.equal(parseOptionalNekudotMoney("0"), 0);
  assert.equal(parseOptionalNekudotMoney("0.00"), 0);
  assert.equal(parseOptionalNekudotMoney("00,00"), 0);
});

test("conserva la validación estricta para un canje real", () => {
  assert.equal(parseOptionalNekudotMoney("125.50"), 12_550);
  assert.throws(() => parseOptionalNekudotMoney("-1.00"), /no es válido/);
  assert.throws(() => parseOptionalNekudotMoney("0.001"), /no es válido/);
});

test("MAX usa todo el saldo disponible sin exceder el total de la compra", () => {
  assert.equal(maximumNekudotRedemptionCents(20_000, 3_450), 3_450);
  assert.equal(maximumNekudotRedemptionCents(1_250, 3_450), 1_250);
  assert.equal(maximumNekudotRedemptionCents(0, 3_450), 0);
  assert.equal(maximumNekudotRedemptionCents(1_250, -50), 0);
});
