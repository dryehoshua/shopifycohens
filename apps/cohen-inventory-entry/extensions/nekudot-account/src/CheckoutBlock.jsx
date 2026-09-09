import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState } from "preact/hooks";
import { money, tierLabel, useNekudotAccount } from "./shared.jsx";

const DEFAULT_BACKEND = "https://cohens-operations-production.up.railway.app";

const TIER_RATE = {
  SILVER: 0.02,
  BLUE: 0.05,
  GOLDEN: 0.08,
};

export default async () => render(<CheckoutBlock />, document.body);

function CheckoutBlock() {
  const state = useNekudotAccount();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [appliedCents, setAppliedCents] = useState(0);
  const [paymentWallet, setPaymentWallet] = useState("nekudot");
  const subtotal = Number(shopify.cost?.subtotalAmount?.value?.amount || 0);

  async function cancelReservation(backend, token, redemptionId, wallet) {
    if (!redemptionId) return;
    await fetch(`${backend}/api/customer-account/nekudot`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ intent: wallet === "voucher" ? "cancel_voucher" : "cancel", redemptionId }),
    }).catch(() => undefined);
  }

  async function redeem(maxRedeemCents) {
    setMessage("");
    const normalized = String(amount).trim().replace(",", ".");
    const amountCents = /^\d+(?:\.\d{1,2})?$/.test(normalized) ? Math.round(Number(normalized) * 100) : 0;
    if (amountCents < 100) return setMessage("El canje mínimo es de $1.00 MXN.");
    if (amountCents > maxRedeemCents) return setMessage(`Puedes usar hasta ${money(maxRedeemCents)} en este pedido.`);
    if (!shopify.instructions?.value?.discounts?.canUpdateDiscountCodes) {
      return setMessage("Este checkout no permite actualizar descuentos. Regresa al carrito para aplicar tus Nekudot.");
    }
    setBusy(true);
    let token = "";
    let backend = DEFAULT_BACKEND;
    let redemptionId = "";
    try {
      token = await shopify.sessionToken.get();
      backend = String(shopify.settings?.value?.backend_url || DEFAULT_BACKEND).trim().replace(/\/$/, "");
      const response = await fetch(`${backend}/api/customer-account/nekudot`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: paymentWallet === "voucher" ? "redeem_voucher" : "redeem",
          amount: normalized,
          subtotalCents: Math.round(subtotal * 100),
          checkoutToken: shopify.checkoutToken?.value || null,
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.code) throw new Error(result?.message || "No pudimos reservar tus Nekudot.");
      redemptionId = result.redemptionId;
      const applied = await shopify.applyDiscountCodeChange({ type: "addDiscountCode", code: result.code });
      if (applied.type !== "success") {
        await cancelReservation(backend, token, redemptionId, paymentWallet);
        throw new Error(applied.message || "Shopify no pudo aplicar el descuento.");
      }
      setAppliedCents(result.amountCents || amountCents);
      setAmount("");
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No pudimos aplicar tus Nekudot.");
    } finally {
      setBusy(false);
    }
  }

  if (state.loading) {
    return <s-banner tone="info">Identificando tu cuenta Nekudot…</s-banner>;
  }

  if (state.error) {
    return (
      <s-banner tone="info" heading="Esta compra puede sumar Nekudot">
        Inicia sesión antes de pagar para vincularla automáticamente. Si continúas como invitado,
        podrás recuperarla después usando el mismo correo o teléfono.
      </s-banner>
    );
  }

  if (!state.data?.registered) {
    return (
      <s-banner tone="info" heading="Activa tus Nekudot">
        Esta compra puede darte cashback. <s-link href={state.data?.registrationUrl}>Crear mi tarjeta gratis</s-link>
      </s-banner>
    );
  }

  const tier = state.data.member.cardTier;
  const estimatedCents = Math.round(subtotal * 100 * (TIER_RATE[tier] || 0));
  const nekudotAvailableCents = Math.max(0, state.data.member.availableCents - (paymentWallet === "nekudot" ? appliedCents : 0));
  const voucherAvailableCents = Math.max(0, (state.data.communityVoucher?.availableCents || 0) - (paymentWallet === "voucher" ? appliedCents : 0));
  const availableCents = paymentWallet === "voucher" ? voucherAvailableCents : nekudotAvailableCents;
  const maxRedeemCents = Math.max(0, Math.min(availableCents, Math.round(subtotal * 100)));

  return (
    <s-stack direction="block" gap="base">
      <s-banner tone="success" heading={`Ganarás aproximadamente ${money(estimatedCents)} en Nekudot`}>
        Tu compra está vinculada a tu tarjeta {tierLabel(tier)}. El saldo se acredita cuando Shopify confirma el pago.
      </s-banner>
      {appliedCents > 0 ? (
        <s-banner tone="success" heading={`${money(appliedCents)} en ${paymentWallet === "voucher" ? "Vales comunitarios" : "Nekudot"} aplicados`}>
          El descuento ya fue restado de los productos de este pedido.
        </s-banner>
      ) : (
        <s-section heading={`Paga con ${paymentWallet === "voucher" ? "Vales comunitarios" : "Nekudot"} · Disponible ${money(availableCents)}`}>
          <s-stack direction="block" gap="base">
            {state.data.communityVoucher ? <s-stack direction="inline" gap="base"><s-button variant={paymentWallet === "nekudot" ? "primary" : "secondary"} onClick={() => { setPaymentWallet("nekudot"); setAmount(""); setMessage(""); }}>Nekudot · {money(nekudotAvailableCents)}</s-button><s-button variant={paymentWallet === "voucher" ? "primary" : "secondary"} onClick={() => { setPaymentWallet("voucher"); setAmount(""); setMessage(""); }}>Vales · {money(voucherAvailableCents)}</s-button></s-stack> : null}
            <s-text-field
              label="Cantidad a descontar (MXN)"
              value={amount}
              inputMode="decimal"
              placeholder="0.00"
              onInput={(event) => setAmount(event.currentTarget.value)}
              error={message || undefined}
            />
            <s-button variant="primary" disabled={busy || maxRedeemCents < 100} onClick={() => redeem(maxRedeemCents)}>
              {busy ? "Aplicando…" : `Aplicar ${paymentWallet === "voucher" ? "Vales" : "Nekudot"} al pedido`}
            </s-button>
            <s-text appearance="subdued">
              Máximo para productos: {money(maxRedeemCents)}. El envío se paga siempre por separado y no se descuenta de estos monederos.
            </s-text>
          </s-stack>
        </s-section>
      )}
    </s-stack>
  );
}
