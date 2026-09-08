import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState } from "preact/hooks";
import { LoadingOrError, money, postNekudotAction, useNekudotAccount } from "./shared.jsx";

export default async () => render(<VoucherPage />, document.body);

function VoucherPage() {
  const state = useNekudotAccount();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (state.loading || state.error || !state.data?.registered) {
    return <s-page heading="Vales comunitarios"><s-box padding="base"><LoadingOrError state={state} /></s-box></s-page>;
  }
  const wallet = state.data.communityVoucher;

  async function activate() {
    setBusy(true);
    setMessage("");
    try {
      await postNekudotAction("activate_community_voucher");
      state.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No pudimos activar la tarjeta.");
    } finally {
      setBusy(false);
    }
  }

  if (!wallet) return <s-page heading="Vales comunitarios">
    <s-stack direction="block" gap="large-200">
      <s-banner tone="info" heading="Tu tarjeta comunitaria todavía no está activa">
        Es un segundo monedero independiente. Recibe apoyos asignados por la comunidad y sólo puede gastarse en Cohen's; no genera cashback ni permite retiros.
      </s-banner>
      <s-section heading="Activar tarjeta virtual de vales">
        <s-stack direction="block" gap="base">
          <s-text>La activación es gratuita. Tu saldo comenzará en cero y aparecerá aquí cuando la administración comunitaria te asigne un apoyo.</s-text>
          {message ? <s-banner tone="critical">{message}</s-banner> : null}
          <s-button variant="primary" disabled={busy} onClick={activate}>{busy ? "Activando…" : "Activar mis vales comunitarios"}</s-button>
        </s-stack>
      </s-section>
    </s-stack>
  </s-page>;

  return <s-page heading="Vales comunitarios">
    <s-stack direction="block" gap="large-200">
      <s-banner tone="success" heading={`${money(wallet.availableCents)} disponibles`}>
        Saldo de apoyo exclusivo para productos Cohen's. No genera cashback, no es transferible y no puede retirarse en efectivo.
      </s-banner>
      <s-section heading="Mi tarjeta virtual de vales">
        <s-box padding="large" border="base" borderRadius="large" background="subdued">
          <s-stack direction="block" gap="base">
            <s-text color="subdued">COHEN'S · APOYO COMUNITARIO</s-text>
            <s-heading>{state.data.member.displayName}</s-heading>
            <s-heading>{money(wallet.availableCents)}</s-heading>
            <s-text color="subdued">Tarjeta {wallet.cardNumber}</s-text>
            <s-stack direction="inline" gap="base">
              <s-image src={wallet.qrDataUrl} alt="QR de vales comunitarios" inlineSize="128px" aspectRatio="1/1" borderRadius="base" />
              <s-image src={wallet.barcodeDataUrl} alt="Código de barras de vales comunitarios" inlineSize="260px" aspectRatio="3/1" objectFit="contain" borderRadius="base" />
            </s-stack>
          </s-stack>
        </s-box>
      </s-section>
      <s-section heading="Movimientos de vales">
        <s-stack direction="block" gap="small-200">
          {wallet.ledger.length ? wallet.ledger.map((entry) => <s-box key={entry.id} padding="base" border="base" borderRadius="base"><s-stack direction="inline" justifyContent="space-between" gap="base"><s-text>{entry.description}</s-text><s-text type="strong">{entry.amountCents > 0 ? "+" : ""}{money(entry.amountCents)}</s-text></s-stack></s-box>) : <s-text color="subdued">Todavía no tienes asignaciones ni consumos.</s-text>}
        </s-stack>
      </s-section>
    </s-stack>
  </s-page>;
}
