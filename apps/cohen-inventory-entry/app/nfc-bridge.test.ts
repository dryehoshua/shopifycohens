import assert from "node:assert/strict";
import test from "node:test";
import { nfcBridgeEventCredential, normalizeNfcBridgeCredential } from "./nfc-bridge.ts";

test("normaliza el UID hexadecimal entregado por el ACR122U", () => {
  assert.equal(normalizeNfcBridgeCredential("04:ab:10:ff"), "04AB10FF");
  assert.equal(nfcBridgeEventCredential({ credential: "a1b2c3d4" }), "A1B2C3D4");
});

test("rechaza respuestas que no sean UIDs hexadecimales completos", () => {
  assert.throws(() => normalizeNfcBridgeCredential("tarjeta demo"));
  assert.throws(() => normalizeNfcBridgeCredential("ABC"));
});
