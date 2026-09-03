import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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

test("el instalador Windows verifica exactamente el PowerShell publicado", () => {
  const command = readFileSync(new URL("../public/downloads/cohens-nfc-windows.cmd", import.meta.url), "utf8");
  const installer = readFileSync(new URL("../public/downloads/windows/install-cohens-nfc-windows.ps1", import.meta.url));
  const installerText = installer.toString("utf8");
  const readerSource = readFileSync(new URL("../public/downloads/windows/acr122u-reader-windows.cs", import.meta.url));
  const launcherScript = readFileSync(new URL("../public/downloads/windows/start-cohens-nfc.ps1", import.meta.url));
  const bridgeScript = readFileSync(new URL("../scripts/nekudot-nfc-bridge.mjs", import.meta.url));
  const publishedHash = (contents: Buffer) => createHash("sha256")
    .update(contents.toString("utf8").replace(/\r\n/g, "\n"))
    .digest("hex")
    .toUpperCase();
  const expectedHash = command.match(/COHENS_NFC_INSTALLER_SHA256=([A-F0-9]{64})/)?.[1];
  const actualHash = publishedHash(installer);
  const expectedReaderHash = installerText.match(/\$ReaderSourceSha256 = "([A-F0-9]{64})"/)?.[1];
  const actualReaderHash = publishedHash(readerSource);
  const expectedLauncherHash = installerText.match(/\$LauncherScriptSha256 = "([A-F0-9]{64})"/)?.[1];
  const actualLauncherHash = publishedHash(launcherScript);
  const expectedBridgeHash = installerText.match(/\$BridgeScriptSha256 = "([A-F0-9]{64})"/)?.[1];
  const actualBridgeHash = publishedHash(bridgeScript);
  assert.equal(expectedHash, actualHash);
  assert.equal(expectedReaderHash, actualReaderHash);
  assert.equal(expectedLauncherHash, actualLauncherHash);
  assert.equal(expectedBridgeHash, actualBridgeHash);
  assert.match(launcherScript.toString("utf8"), /CohensNekudotNfcWatchdog/);
  assert.match(launcherScript.toString("utf8"), /while \(\$true\)/);
  assert.match(launcherScript.toString("utf8"), /se reiniciará/);
  assert.match(bridgeScript.toString("utf8"), /\/printer\/health/);
  assert.match(bridgeScript.toString("utf8"), /\/printer\/print/);
  assert.match(bridgeScript.toString("utf8"), /Generic \/ Text Only/);
  assert.match(command, /Get-FileHash -Algorithm SHA256/);
});
