import test from "node:test";
import assert from "node:assert/strict";
import { reactivateNfcBridge, reactivateNfcWhenStarted, NfcRecoveryError } from "./nfc-recovery.ts";
import { readFileSync } from "node:fs";

test("POS tienda conserva el control de recuperacion en el tester NFC", () => {
  const diagnostics = readFileSync(new URL("./components/NfcReaderDiagnostics.tsx", import.meta.url), "utf8");
  const pos = readFileSync(new URL("./routes/retail-pos.tsx", import.meta.url), "utf8");
  assert.match(diagnostics, /import \{ NfcBridgeRecovery \} from "\.\/NfcBridgeRecovery"/);
  assert.match(diagnostics, /locationLabel === "Tienda" \? <NfcBridgeRecovery/);
  assert.match(pos, /<NfcReaderDiagnostics[^>]*locationLabel="Tienda"/);
});

test("reactivacion exige supervisor compatible y envia token en POST", async () => {
  const calls: Array<{url: string; init?: RequestInit}> = [];
  await reactivateNfcBridge((async (url, init) => {
    calls.push({url: String(url), init});
    return calls.length === 1 ? Response.json({watchdog: "cohens-hardware", version: 2, recoveryToken: "test-token"}) : Response.json({ok: true}, {status: 202});
  }) as typeof fetch);
  assert.equal(calls[1].url, "http://127.0.0.1:17813/reactivate");
  assert.equal(calls[1].init?.method, "POST");
  assert.deepEqual(calls[1].init?.headers, {"X-Cohens-Recovery": "test-token"});
});
test("supervisor apagado ofrece apertura local, no reporta exito", async () => {
  await assert.rejects(reactivateNfcBridge((async () => {throw new TypeError("offline");}) as typeof fetch),
    (error: unknown) => error instanceof NfcRecoveryError && error.canLaunch);
});
test("supervisor antiguo no recibe orden de reinicio", async () => {
  let calls = 0;
  await assert.rejects(reactivateNfcBridge((async () => { calls++; return Response.json({watchdog: "cohens-hardware"}); }) as typeof fetch), /actualización/);
  assert.equal(calls, 1);
});
test("recuperacion rechazada no se anuncia como completada", async () => {
  let calls = 0;
  await assert.rejects(reactivateNfcBridge((async () => ++calls === 1
    ? Response.json({watchdog: "cohens-hardware", version: 2, recoveryToken: "test"})
    : Response.json({error: "Espera unos segundos"}, {status: 409})) as typeof fetch), /Espera/);
});

test("espera arranque en frio y recupera sin segundo boton", async () => {
  let calls = 0;
  await reactivateNfcWhenStarted((async () => {
    if (++calls < 3) throw new TypeError("starting");
    return calls === 3 ? Response.json({watchdog: "cohens-hardware", version: 2, recoveryToken: "test"}) : Response.json({ok: true}, {status: 202});
  }) as typeof fetch, async () => {});
  assert.equal(calls, 4);
});
test("espera al supervisor ocupado en vez de abandonar", async () => {
  let posts = 0;
  await reactivateNfcWhenStarted((async (url) => String(url).endsWith("/reactivate")
    ? Response.json({}, {status: ++posts === 1 ? 409 : 202})
    : Response.json({watchdog: "cohens-hardware", version: 2, recoveryToken: "test"})) as typeof fetch, async () => {});
  assert.equal(posts, 2);
});
test("fallo persistente termina sin afirmar exito", async () => {
  let calls = 0;
  await assert.rejects(reactivateNfcWhenStarted((async () => {calls++; throw new TypeError("offline");}) as typeof fetch, async () => {}), NfcRecoveryError);
  assert.equal(calls, 8);
});
test("el click abre programa antes de esperar red y no exige segundo enlace", () => {
  const source = readFileSync(new URL("./components/NfcBridgeRecovery.tsx", import.meta.url), "utf8");
  assert.ok(source.indexOf("window.location.href = NFC_LAUNCH_URL") < source.indexOf("await reactivateNfcWhenStarted"));
  assert.ok(!source.includes("href={NFC_LAUNCH_URL}"));
  assert.ok(source.includes("health.readerConnected && !health.error"));
});
