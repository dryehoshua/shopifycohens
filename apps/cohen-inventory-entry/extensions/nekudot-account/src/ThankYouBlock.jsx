import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { money, useNekudotAccount } from "./shared.jsx";

export default async () => render(<ThankYouBlock />, document.body);

function ThankYouBlock() {
  const state = useNekudotAccount();
  if (state.loading) return <s-banner tone="info">Confirmando tus Nekudot…</s-banner>;
  if (state.error) return <s-banner tone="info" heading="Conserva tu compra Nekudot">Si compraste como invitado, conecta tu cuenta con el mismo correo o teléfono para recuperar este pedido cuando el pago quede confirmado.</s-banner>;
  if (!state.data?.registered) return <s-banner tone="info" heading="Recupera los Nekudot de esta compra"><s-link href={state.data?.registrationUrl}>Crear o conectar mi tarjeta Nekudot</s-link></s-banner>;

  const orderId = shopify.orderConfirmation?.value?.order?.id;
  const accrual = state.data.accruals.find((item) => item.orderId === orderId);
  if (!accrual) return <s-banner tone="info" heading="Tu compra está vinculada">El cashback aparecerá en tu saldo Nekudot cuando Shopify confirme el pago.</s-banner>;

  return <s-banner tone="success" heading={`Ganaste ${money(accrual.clientEarnedCents)} en Nekudot`}>Ya vinculamos este pedido con tu cuenta. Tus Nekudot personales se mantienen separados de los puntos por referidos.</s-banner>;
}
