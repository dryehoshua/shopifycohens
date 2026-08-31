import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

export default async () => render(<NekudotModal />, document.body);

function operationKey() {
  return `nekudot:${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function money(cents) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);
}

function cartSubtotalCents() {
  const raw = String(shopify.cart.current.value.subtotal ?? "0").replace(/[^0-9.-]/g, "");
  return Math.max(0, Math.round(Number(raw || 0) * 100));
}

async function backend(path, options = {}) {
  const token = await shopify.session.getSessionToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({ ok: false, error: "Respuesta inválida del servidor." }));
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error || "No se pudo completar la operación.");
    error.code = payload.code;
    throw error;
  }
  return payload;
}

function NekudotModal() {
  const [credential, setCredential] = useState("");
  const [member, setMember] = useState(null);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const lookupRef = useRef(null);

  async function lookup(raw) {
    const value = String(raw || "").trim();
    if (!value) return setMessage("Escanea o escribe el ID Nekudot.");
    setBusy(true); setMessage(""); setMember(null); setCredential(value);
    try {
      const payload = await backend("/api/pos/nekudot", {
        method: "POST",
        body: JSON.stringify({ intent: "lookup", credential: value }),
      });
      if (!payload.member.currentShopIdentity) {
        throw new Error("La tarjeta existe, pero falta vincular el cliente de esta tienda desde el panel Nekudot.");
      }
      await shopify.cart.setCustomer({ id: Number(payload.member.currentShopIdentity.legacyCustomerId) });
      await shopify.cart.addCartProperties({ nekudot_member_id: payload.member.id });
      setMember(payload.member);
      shopify.toast.show(`${payload.member.displayName} identificado`);
    } catch (error) {
      setMessage(error.message);
    } finally { setBusy(false); }
  }
  lookupRef.current = lookup;

  useEffect(() => {
    const unsubscribe = shopify.scanner.scannerData.current.subscribe((scan) => {
      if (scan?.data) lookupRef.current?.(scan.data);
    });
    return () => { unsubscribe(); shopify.scanner.hideCameraScanner(); };
  }, []);

  async function redeem() {
    const amountCents = Math.round(Number(amount) * 100);
    const subtotalCents = cartSubtotalCents();
    if (!Number.isInteger(amountCents) || amountCents <= 0) return setMessage("Escribe un importe válido.");
    if (amountCents > subtotalCents) return setMessage("El canje no puede superar el subtotal del carrito.");
    setBusy(true); setMessage("");
    let reservation;
    try {
      const payload = await backend("/api/pos/nekudot", { method: "POST", body: JSON.stringify({
        intent: "reserve", credential, amount, cartTotalCents: subtotalCents,
        cartReference: shopify.cart.current.value.id ?? shopify.session.currentSession.deviceId,
        idempotencyKey: operationKey(),
      }) });
      reservation = payload.reservation;
      await shopify.cart.applyCartDiscount("FixedAmount", "Nekudot Cohen's", (reservation.amountCents / 100).toFixed(2));
      await shopify.cart.addCartProperties({
        nekudot_member_id: member.id,
        nekudot_redemption_id: reservation.id,
      });
      shopify.toast.show(`${money(reservation.amountCents)} en Nekudot aplicados`);
      shopify.action.dismissModal();
    } catch (error) {
      if (reservation?.id) {
        await backend("/api/pos/nekudot", { method: "POST", body: JSON.stringify({ intent: "cancel", reservationId: reservation.id }) }).catch(() => {});
      }
      setMessage(error.message);
    } finally { setBusy(false); }
  }

  return <s-page heading="Nekudot Cohen's"><s-scroll-box><s-box padding="base"><s-stack direction="block" gap="base">
    <s-banner tone="info" heading="5% para el cliente · 5% para su broker">La misma tarjeta funciona en tienda y cafetería. El saldo se confirma al completar la compra.</s-banner>
    {message ? <s-banner tone="critical" heading="No se pudo continuar">{message}</s-banner> : null}
    {!member ? <s-section heading="Identificar miembro"><s-stack direction="block" gap="base"><s-text-field label="ID RFID o QR" value={credential} onInput={(event) => setCredential(event.currentTarget.value)} placeholder="Escanea o escribe" /><s-stack direction="inline" gap="base"><s-button variant="primary" disabled={busy} onClick={() => lookup(credential)}>{busy ? "Buscando…" : "Buscar"}</s-button><s-button variant="secondary" onClick={() => shopify.scanner.showCameraScanner()}>Usar cámara</s-button></s-stack></s-stack></s-section> : <>
      <s-section heading={member.displayName}><s-stack direction="block" gap="base"><s-banner tone="success" heading={`Disponible: ${money(member.availableCents)}`}>{member.broker ? `Broker: ${member.broker.displayName}` : "Sin broker asignado"}</s-banner><s-text-field label="Nekudot a usar (MXN)" value={amount} inputMode="decimal" onInput={(event) => setAmount(event.currentTarget.value)} placeholder="0.00" /><s-button variant="primary" disabled={busy || member.availableCents <= 0 || cartSubtotalCents() <= 0} onClick={redeem}>{busy ? "Aplicando…" : "Aplicar al carrito"}</s-button><s-button variant="secondary" onClick={() => { setMember(null); setCredential(""); setAmount(""); }}>Leer otra tarjeta</s-button></s-stack></s-section>
    </>}
  </s-stack></s-box></s-scroll-box></s-page>;
}
