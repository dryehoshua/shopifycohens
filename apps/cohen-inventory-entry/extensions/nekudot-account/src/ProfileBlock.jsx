import { render } from "preact";
import { LoadingOrError, money, tierLabel, useNekudotAccount } from "./shared.jsx";

export default async () => render(<ProfileBlock />, document.body);

function ProfileBlock() {
  const state = useNekudotAccount();
  if (state.loading || state.error || !state.data?.registered) return <LoadingOrError state={state} />;
  const { member } = state.data;
  return <s-section heading="Tarjeta Nekudot"><s-stack direction="block" gap="small-200"><s-text type="strong">{money(member.availableCents)} disponibles</s-text><s-text color="subdued">{tierLabel(member.cardTier)} · Tarjeta •••• {String(member.cardNumber || "").slice(-4)}</s-text><s-link href="extension:nekudot-account/">Abrir mi tarjeta, movimientos y compras</s-link></s-stack></s-section>;
}
