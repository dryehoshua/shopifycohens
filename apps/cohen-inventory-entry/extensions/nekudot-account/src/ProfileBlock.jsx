import { render } from "preact";
import { LoadingOrError, money, tierLabel, useNekudotAccount } from "./shared.jsx";

export default async () => render(<ProfileBlock />, document.body);

function ProfileBlock() {
  const state = useNekudotAccount();
  if (state.loading || state.error || !state.data?.registered) return <LoadingOrError state={state} />;
  const { member, ibWallet } = state.data;
  return <s-section heading="Nekudot Cohen's"><s-stack direction="block" gap="small-200"><s-text type="strong">{money(member.availableCents)} disponibles · {tierLabel(member.cardTier)}</s-text>{ibWallet ? <s-text color="subdued">Comisión IB separada: {money(ibWallet.availableCents)}</s-text> : null}<s-link href="extension:nekudot-account/">Ver movimientos y tarjeta</s-link></s-stack></s-section>;
}
