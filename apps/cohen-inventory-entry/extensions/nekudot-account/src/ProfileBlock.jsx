import { render } from "preact";
import { LoadingOrError, money, tierLabel, useNekudotAccount } from "./shared.jsx";

export default async () => render(<ProfileBlock />, document.body);

function ProfileBlock() {
  const state = useNekudotAccount();
  if (state.loading || state.error) return <LoadingOrError state={state} />;
  if (!state.data?.registered) return <s-section heading="Completa tu cuenta Cohen's"><s-stack direction="block" gap="base"><LoadingOrError state={state} /><s-link href="extension:nekudot-account/">Completar mi perfil dentro de Shopify</s-link></s-stack></s-section>;
  const { member } = state.data;
  return <s-section heading={`Bienvenido a Cohen's, ${member.displayName}`}><s-stack direction="block" gap="base"><s-stack direction="inline" gap="base" alignItems="center"><s-avatar src={member.photoUrl || undefined} initials={member.displayName.slice(0, 2).toUpperCase()} accessibilityLabel={`Foto de ${member.displayName}`} /><s-stack direction="block" gap="small-100"><s-text type="strong">{money(member.availableCents)} en Nekudot</s-text><s-text color="subdued">{tierLabel(member.cardTier)} · Tarjeta •••• {String(member.cardNumber || "").slice(-4)}</s-text></s-stack></s-stack><s-button href="https://cohenskosher.com/collections/all" variant="primary">Comenzar a comprar</s-button><s-link href="extension:nekudot-account/">Abrir mi portal Cohen's</s-link></s-stack></s-section>;
}
