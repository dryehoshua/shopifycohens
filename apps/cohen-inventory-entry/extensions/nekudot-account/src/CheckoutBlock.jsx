import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { money, tierLabel, useNekudotAccount } from "./shared.jsx";

const TIER_RATE = {
  SILVER: 0.02,
  BLUE: 0.05,
  GOLDEN: 0.08,
};

export default async () => render(<CheckoutBlock />, document.body);

function CheckoutBlock() {
  const state = useNekudotAccount();
  const subtotal = Number(shopify.cost?.subtotalAmount?.value?.amount || 0);

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

  return (
    <s-banner tone="success" heading={`Ganarás aproximadamente ${money(estimatedCents)} en Nekudot`}>
      Tu compra está vinculada a tu tarjeta {tierLabel(tier)}. El saldo se acredita cuando Shopify
      confirma el pago.
    </s-banner>
  );
}
