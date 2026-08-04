import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCartInput,
  includedTaxCents,
  normalizeCafeName,
  parseMoneyToCents,
  receiptColumns,
  safeIdempotencyKey,
  wrapReceiptText,
} from "./cafe-pos-domain.ts";

test("normaliza nombres de personal", () => {
  assert.equal(normalizeCafeName("  José   Pérez "), "jose perez");
});

test("convierte importes decimales a centavos", () => {
  assert.equal(parseMoneyToCents("123.45"), 12_345);
  assert.throws(() => parseMoneyToCents("-1"));
});

test("fusiona variantes repetidas y valida cantidades", () => {
  const id = "gid://shopify/ProductVariant/123";
  assert.deepEqual(assertCartInput([{ variantId: id, quantity: 1 }, { variantId: id, quantity: 2 }]), [
    { variantId: id, quantity: 3 },
  ]);
  assert.throws(() => assertCartInput([{ variantId: id, quantity: 0 }]));
});

test("extrae IVA incluido sin alterar el total", () => {
  assert.equal(includedTaxCents(11600, 1600), 1600);
  assert.equal(includedTaxCents(10000, 0), 0);
});

test("valida llave idempotente", () => {
  assert.equal(safeIdempotencyKey("sale_1234567890123456"), "sale_1234567890123456");
  assert.throws(() => safeIdempotencyKey("corta"));
});

test("ajusta texto y columnas al papel de 32 caracteres", () => {
  assert.deepEqual(wrapReceiptText("uno dos tres", 7), ["uno dos", "tres"]);
  assert.equal(receiptColumns("TOTAL", "$120.00", 20).length, 20);
});
