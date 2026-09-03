import { render } from "preact";
import { LoadingOrError, money, tierLabel, useNekudotAccount } from "./shared.jsx";

export default async () => render(<AccountPage />, document.body);

function AccountPage() {
  const state = useNekudotAccount();
  if (state.loading || state.error || !state.data?.registered) {
    return <s-page heading="Mis Nekudot"><s-box padding="base"><LoadingOrError state={state} /></s-box></s-page>;
  }
  const { member, ibWallet, accruals, ledger, portalUrl } = state.data;
  return <s-page heading="Mis Nekudot"><s-stack direction="block" gap="base">
    <s-section heading={`Hola, ${member.displayName}`}>
      <s-stack direction="block" gap="small-200">
        <s-text type="strong">{money(member.availableCents)} disponibles</s-text>
        <s-text color="subdued">Tarjeta {tierLabel(member.cardTier)} · Ganado históricamente: {money(member.lifetimeEarnedCents)}</s-text>
        <s-link href={portalUrl}>Abrir tarjeta QR y código de barras</s-link>
      </s-stack>
    </s-section>
    {ibWallet ? <s-section heading="Mis comisiones IB"><s-stack direction="block" gap="small-200"><s-text type="strong">{money(ibWallet.availableCents)} disponibles</s-text><s-text color="subdued">Código {ibWallet.code} · Este saldo está separado de tus Nekudot personales.</s-text></s-stack></s-section> : null}
    <s-section heading="Compras que generaron Nekudot"><s-stack direction="block" gap="small-200">
      {accruals.length ? accruals.map((item) => <s-box key={item.orderId} padding="small-200" border="base"><s-stack direction="inline" gap="base"><s-text type="strong">{item.orderName}</s-text><s-text>{money(item.clientEarnedCents)} Nekudot{item.brokerEarnedCents ? ` + ${money(item.brokerEarnedCents)} IB` : ""}</s-text></s-stack></s-box>) : <s-text color="subdued">Aún no hay compras acreditadas.</s-text>}
    </s-stack></s-section>
    <s-section heading="Movimientos recientes"><s-stack direction="block" gap="small-200">
      {ledger.length ? ledger.map((entry) => <s-box key={entry.id} padding="small-200"><s-text>{entry.description}: {entry.amountCents >= 0 ? "+" : ""}{money(entry.amountCents)}</s-text></s-box>) : <s-text color="subdued">Tus movimientos aparecerán aquí.</s-text>}
    </s-stack></s-section>
  </s-stack></s-page>;
}
