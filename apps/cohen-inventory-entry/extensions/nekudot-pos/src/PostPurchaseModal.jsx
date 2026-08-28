import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

export default async () => render(<PostPurchaseModal />, document.body);

function money(cents) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);
}

async function backend(path, options = {}) {
  const token = await shopify.session.getSessionToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...options, headers });
  const payload = await response.json().catch(() => ({ ok: false, error: "Respuesta inválida del servidor." }));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || "No se pudo acreditar Nekudot.");
  return payload;
}

function PostPurchaseModal() {
  const [credential, setCredential] = useState("");
  const [result, setResult] = useState(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const attachRef = useRef(null);

  async function attach(raw) {
    const value = String(raw || "").trim();
    if (!value) return setMessage("Escanea o escribe el ID de la tarjeta Cohen's.");
    setCredential(value); setBusy(true); setMessage(""); setResult(null);
    try {
      const payload = await backend("/api/pos/nekudot", {
        method: "POST",
        body: JSON.stringify({
          intent: "attach_order",
          orderId: shopify.order.id,
          credential: value,
        }),
      });
      setResult(payload);
      shopify.toast.show(`${money(payload.earnedCents)} acreditados a ${payload.member.displayName}`);
      shopify.scanner.hideCameraScanner();
    } catch (error) {
      setMessage(error.message);
    } finally { setBusy(false); }
  }
  attachRef.current = attach;

  useEffect(() => {
    const unsubscribe = shopify.scanner.scannerData.current.subscribe((scan) => {
      if (scan?.data) attachRef.current?.(scan.data);
    });
    return () => { unsubscribe(); shopify.scanner.hideCameraScanner(); };
  }, []);

  return <s-page heading="Acreditar Nekudot"><s-scroll-box><s-box padding="base"><s-stack direction="block" gap="base">
    <s-banner tone="info" heading="La tarjeta solo identifica al cliente">El saldo se guarda en su perfil Nekudot, no dentro de la tarjeta.</s-banner>
    {message ? <s-banner tone="critical" heading="No se acreditaron puntos">{message}</s-banner> : null}
    {result ? <s-banner tone="success" heading={`${money(result.earnedCents)} acreditados`}>{result.member.displayName} ahora tiene {money(result.member.availableCents)} disponibles. La operación está ligada al pedido {result.orderName}.</s-banner> : <s-section heading="¿Tiene tarjeta Cohen's?"><s-stack direction="block" gap="base">
      <s-text-field label="ID RFID o QR" value={credential} onInput={(event) => setCredential(event.currentTarget.value)} placeholder="Escanea o escribe" />
      <s-stack direction="inline" gap="base">
        <s-button variant="primary" disabled={busy} onClick={() => attach(credential)}>{busy ? "Acreditando…" : "Acreditar 5%"}</s-button>
        <s-button variant="secondary" disabled={busy} onClick={() => shopify.scanner.showCameraScanner()}>Escanear QR</s-button>
      </s-stack>
    </s-stack></s-section>}
    <s-button variant="secondary" onClick={() => shopify.action.dismissModal()}>{result ? "Listo" : "No tiene tarjeta"}</s-button>
  </s-stack></s-box></s-scroll-box></s-page>;
}
