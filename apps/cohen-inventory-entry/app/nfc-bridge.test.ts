import assert from "node:assert/strict";
import test from "node:test";
import {
  nfcBridgeEventCredential,
  normalizeNfcBridgeCredential,
  summarizeNfcReaderTest,
  type NfcBridgeHealth,
} from "./nfc-bridge.ts";

const healthyReader: NfcBridgeHealth = {
  ok: true,
  bridge: "nekudot-nfc",
  version: 1,
  readerConnected: true,
  reader: "ACS ACR122U PICC Interface",
  cardPresent: false,
  sequence: 7,
  error: null,
};

test("normaliza el UID hexadecimal entregado por el ACR122U", () => {
  assert.equal(normalizeNfcBridgeCredential("04:ab:10:ff"), "04AB10FF");
  assert.equal(nfcBridgeEventCredential({ credential: "a1b2c3d4" }), "A1B2C3D4");
});

test("rechaza respuestas que no sean UIDs hexadecimales completos", () => {
  assert.throws(() => normalizeNfcBridgeCredential("tarjeta demo"));
  assert.throws(() => normalizeNfcBridgeCredential("ABC"));
});

test("aprueba tres lecturas estables del mismo UID", () => {
  const result = summarizeNfcReaderTest(healthyReader, ["A1B2C3D4", "A1B2C3D4", "A1B2C3D4"]);
  assert.deepEqual(result, {
    bridge: "pass",
    reader: "pass",
    scans: "pass",
    stableCredential: "A1B2C3D4",
    passed: true,
  });
});

test("reporta un lector físico desconectado", () => {
  const result = summarizeNfcReaderTest({ ...healthyReader, readerConnected: false }, []);
  assert.equal(result.bridge, "pass");
  assert.equal(result.reader, "fail");
  assert.equal(result.scans, "pending");
  assert.equal(result.passed, false);
});

test("rechaza identificadores inconsistentes durante la prueba", () => {
  const result = summarizeNfcReaderTest(healthyReader, ["A1B2C3D4", "A1B2C3D4", "01020304"]);
  assert.equal(result.scans, "fail");
  assert.equal(result.stableCredential, null);
  assert.equal(result.passed, false);
});
