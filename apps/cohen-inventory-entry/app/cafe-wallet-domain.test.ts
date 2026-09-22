import assert from "node:assert/strict";
import test from "node:test";
import { exactCafeContactMatch, cafeWalletChoice } from "./cafe-wallet-domain.ts";

test("vinculación de cafetería exige contacto exacto y no solo nombre", () => {
  const member = { email: "Cliente@example.com", phone: "+52 55 1234 5678" };
  assert.equal(exactCafeContactMatch(member, { email: "cliente@example.com", phone: null }), true);
  assert.equal(exactCafeContactMatch(member, { email: null, phone: "+525512345678" }), true);
  assert.equal(exactCafeContactMatch(member, { email: "otro@example.com", phone: "12345678" }), false);
  assert.equal(exactCafeContactMatch({ email: null, phone: null }, { email: null, phone: null }), false);
});

test("vales y Nekudot nunca se intercambian por un tipo de saldo desconocido", () => {
  assert.equal(cafeWalletChoice(undefined), "nekudot");
  assert.equal(cafeWalletChoice("voucher"), "voucher");
  assert.throws(() => cafeWalletChoice("gold"));
});
