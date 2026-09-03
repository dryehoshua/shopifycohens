import { render } from "preact";
import { LoadingOrError, money, useNekudotAccount } from "./shared.jsx";

export default async () => render(<OrderStatusBlock />, document.body);

function OrderStatusBlock() {
  const state = useNekudotAccount();
  if (state.loading || state.error || !state.data?.registered) return <LoadingOrError state={state} />;
  const orderId = shopify.order?.value?.id;
  const accrual = state.data.accruals.find((item) => item.orderId === orderId);
  if (!accrual) return <s-banner tone="info" heading="Nekudot Cohen's">Cuando el pago se confirme, verás aquí el cashback de este pedido.</s-banner>;
  return <s-banner tone="success" heading={`Ganaste ${money(accrual.clientEarnedCents)} en Nekudot`}>{accrual.brokerEarnedCents ? `Además se registraron ${money(accrual.brokerEarnedCents)} en tu wallet IB separada.` : "Ya están reflejados en tu cuenta."}</s-banner>;
}
