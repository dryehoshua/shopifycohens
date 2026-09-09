import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState } from "preact/hooks";
import { LoadingOrError, money, postNekudotAction, useNekudotAccount } from "./shared.jsx";

const COMMUNITIES = ["Kehila Ashkenazi", "Maguen David", "Monte Sinai", "Comunidad Sefaradí", "Comunidad Bet El", "Beth Israel Community Center", "Jabad Lubavitch"];

export default async () => render(<ReferralPage />, document.body);

function ReferralPage() {
  const state = useNekudotAccount();
  const [code, setCode] = useState("");
  const [community, setCommunity] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  if (state.loading || state.error || !state.data?.registered) {
    return <s-page heading="Programa de referidos"><s-box padding="base"><LoadingOrError state={state} /></s-box></s-page>;
  }
  const wallet = state.data.ibWallet;

  async function activate() {
    setBusy("activate"); setMessage("");
    try {
      await postNekudotAction("activate_ib", { code, community });
      setMessage("Tu Programa de referidos quedó activo."); state.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No pudimos activarlo."); }
    finally { setBusy(""); }
  }

  async function move(intent) {
    setBusy(intent); setMessage("");
    try {
      await postNekudotAction(intent, { amount });
      setMessage(intent === "ib_gold_to_store" ? "Tus Nekudot Gold ya pueden usarse en Cohen's." : "Tu retiro quedó en revisión.");
      setAmount(""); state.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : "No pudimos completar la operación."); }
    finally { setBusy(""); }
  }

  if (!wallet) return <s-page heading="Programa de referidos" subheading="Actívalo sin crear otra cuenta">
    <s-stack direction="block" gap="large-200">
      <s-banner tone="info" heading="Tu programa está disponible para activarse">Comparte tu código con nuevos clientes Blue. Sus compras elegibles generan Nekudot Gold separados de tus puntos personales.</s-banner>
      <s-section heading="Crear mi código">
        <s-stack direction="block" gap="base">
          <s-text-field label="Código de referido" value={code} required placeholder="Ej. FAMILIA-COHEN" onInput={(event) => setCode(event.currentTarget.value)} />
          <s-select label="Comunidad" value={community} required onChange={(event) => setCommunity(event.currentTarget.value)}><s-option value="">Selecciona tu comunidad</s-option>{COMMUNITIES.map((item) => <s-option key={item} value={item}>{item}</s-option>)}</s-select>
          {message ? <s-banner tone="critical">{message}</s-banner> : null}
          <s-button variant="primary" disabled={Boolean(busy) || code.trim().length < 2 || !community} onClick={activate}>{busy ? "Activando…" : "Activar mi Programa de referidos"}</s-button>
        </s-stack>
      </s-section>
    </s-stack>
  </s-page>;

  const inviteUrl = `https://cohenskosher.com/apps/nekudot/registro/blue?ib=${encodeURIComponent(wallet.code)}`;
  return <s-page heading="Programa de referidos" subheading={`Código ${wallet.code}`}>
    <s-stack direction="block" gap="large-200">
      <s-banner tone="success" heading={`${money(wallet.availableCents)} en Nekudot Gold disponibles`}>Puedes usarlos en la tienda o solicitar retiro.</s-banner>
      <s-section heading="Invitar clientes"><s-stack direction="block" gap="base"><s-link href={inviteUrl}>{inviteUrl}</s-link><s-text color="subdued">La persona llegará al registro Blue dentro de cohenskosher.com y después continuará a su cuenta Shopify.</s-text></s-stack></s-section>
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base"><Metric label="Gold históricos" value={money(wallet.lifetimeCommissionCents)} /><Metric label="En retiro" value={money(wallet.reservedWithdrawalCents)} /><Metric label="Personas referidas" value={String(wallet.referredClients.length)} /></s-grid>
      <s-section heading="Usar o retirar"><s-stack direction="block" gap="base"><s-text-field label="Cantidad (MXN)" value={amount} inputMode="decimal" onInput={(event) => setAmount(event.currentTarget.value)} /><s-stack direction="inline" gap="base"><s-button variant="primary" disabled={Boolean(busy) || !amount} onClick={() => move("ib_gold_to_store")}>Usar en Cohen's</s-button><s-button variant="secondary" disabled={Boolean(busy) || !amount} onClick={() => move("ib_gold_withdrawal")}>Solicitar retiro</s-button></s-stack>{message ? <s-banner tone="info">{message}</s-banner> : null}</s-stack></s-section>
      <s-section heading="Mi red"><s-stack direction="block" gap="small-200">{wallet.referredClients.length ? wallet.referredClients.map((client) => <s-box key={client.id} padding="base" border="base" borderRadius="base"><s-stack direction="inline" justifyContent="space-between" gap="base"><s-text type="strong">{client.displayName}</s-text><s-text>{client.active ? "Activo" : "Inactivo"}</s-text></s-stack></s-box>) : <s-text color="subdued">Todavía no hay personas vinculadas.</s-text>}</s-stack></s-section>
    </s-stack>
  </s-page>;
}

function Metric({ label, value }) {
  return <s-box padding="base" border="base" borderRadius="base"><s-stack direction="block" gap="small-100"><s-text color="subdued">{label}</s-text><s-heading>{value}</s-heading></s-stack></s-box>;
}
