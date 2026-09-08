import { render } from "preact";
import { LoadingOrError, money, tierLabel, useNekudotAccount } from "./shared.jsx";

export default async () => render(<AccountPage />, document.body);

function AccountPage() {
  const state = useNekudotAccount();
  if (state.loading || state.error || !state.data?.registered) {
    return <s-page heading="Tarjeta Nekudot"><s-box padding="base"><LoadingOrError state={state} /></s-box></s-page>;
  }
  const { member, accruals, ledger, ibWallet, portalUrl } = state.data;
  const isVoucher = member.cardTier === "VOUCHER";
  return <s-page heading={isVoucher ? "Tarjeta de vales" : "Tarjeta Nekudot"}>
    <s-stack direction="block" gap="large-200">
      <s-section heading={`Hola, ${member.displayName}`}>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
          <Metric label={isVoucher ? "Saldo de vales" : "Disponible para comprar"} value={money(member.availableCents)} />
          <Metric label="Tu tarjeta" value={tierLabel(member.cardTier)} />
          <Metric label="Ganado históricamente" value={money(member.lifetimeEarnedCents)} />
        </s-grid>
      </s-section>

      <s-section heading={isVoucher ? "Mi tarjeta de vales" : "Mi tarjeta digital"}>
        <s-stack direction="block" gap="base">
          <s-box padding="large" border="base" borderRadius="large" background="subdued">
            <s-stack direction="block" gap="base">
              <s-stack direction="inline" gap="base" justifyContent="space-between">
                <s-stack direction="block" gap="small-100">
                  <s-text color="subdued">COHEN'S · {tierLabel(member.cardTier)}</s-text>
                  <s-heading>{member.displayName}</s-heading>
                  <s-text type="strong">{money(member.availableCents)} disponibles</s-text>
                  <s-text color="subdued">Tarjeta •••• {String(member.cardNumber || "").slice(-4)}</s-text>
                </s-stack>
                <s-stack direction="inline" gap="base">
                  {member.photoUrl ? <s-image src={member.photoUrl} alt={`Foto de ${member.displayName}`} inlineSize="92px" aspectRatio="4/5" objectFit="cover" borderRadius="base" /> : null}
                  {member.qrDataUrl ? <s-image src={member.qrDataUrl} alt="Código QR de la tarjeta Nekudot" inlineSize="128px" aspectRatio="1/1" borderRadius="base" /> : null}
                </s-stack>
              </s-stack>
              {member.barcodeDataUrl ? <s-image src={member.barcodeDataUrl} alt="Código de barras de la tarjeta Nekudot" inlineSize="100%" maxInlineSize="360px" aspectRatio="3/1" objectFit="contain" borderRadius="base" /> : null}
              <s-text color="subdued">Presenta el QR o el código de barras en caja. Tu NFC, QR y código de barras identifican la misma cuenta.</s-text>
            </s-stack>
          </s-box>
          {!isVoucher ? <s-button href={portalUrl} variant="primary">Usar Nekudot en una compra</s-button> : null}
        </s-stack>
      </s-section>

      {ibWallet ? <s-section heading="Mi programa de referidos IB">
        <s-stack direction="block" gap="base">
          <s-banner tone="info" heading={`Código IB: ${ibWallet.code}`}>Tus comisiones están separadas de tus Nekudot personales.</s-banner>
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
            <Metric label="Comisión disponible" value={money(ibWallet.availableCents)} />
            <Metric label="Comisión histórica" value={money(ibWallet.lifetimeCommissionCents)} />
            <Metric label="Personas referidas" value={String(ibWallet.referredClients.length)} />
          </s-grid>
          <s-stack direction="block" gap="small-200">
            {ibWallet.referredClients.length ? ibWallet.referredClients.map((client) => <s-box key={client.id} padding="base" border="base" borderRadius="base"><s-stack direction="inline" gap="base" justifyContent="space-between"><s-stack direction="block" gap="small-100"><s-text type="strong">{client.displayName}</s-text><s-text color="subdued">{client.community || "Sin comunidad"} · {tierLabel(client.cardTier)}</s-text></s-stack><s-text>{client.active ? "Activo" : "Inactivo"}</s-text></s-stack></s-box>) : <s-text color="subdued">Todavía no hay personas vinculadas con tu código.</s-text>}
          </s-stack>
        </s-stack>
      </s-section> : null}

      {isVoucher ? <s-section heading="Tarjeta de vales">
        <s-banner tone="info" heading={`${money(member.availableCents)} disponibles en vales`}>El saldo de vales no genera cashback ni se mezcla con comisiones IB.</s-banner>
      </s-section> : null}

      <s-section heading="Compras que generaron Nekudot">
        <s-stack direction="block" gap="small-200">
          {accruals.length ? accruals.map((item) => <s-box key={item.orderId} padding="base" border="base" borderRadius="base"><s-stack direction="inline" gap="base" justifyContent="space-between"><s-stack direction="block" gap="small-100"><s-text type="strong">{item.orderName}</s-text><s-text color="subdued">Compra acreditada</s-text></s-stack><s-text type="strong">+{money(item.clientEarnedCents)}</s-text></s-stack></s-box>) : <s-box padding="base" border="base" borderRadius="base"><s-text color="subdued">Aún no hay compras acreditadas.</s-text></s-box>}
        </s-stack>
      </s-section>

      <s-section heading="Movimientos recientes">
        <s-stack direction="block" gap="small-200">
          {ledger.length ? ledger.map((entry) => <s-box key={entry.id} padding="base"><s-stack direction="inline" gap="base" justifyContent="space-between"><s-text>{entry.description}</s-text><s-text type="strong">{entry.amountCents >= 0 ? "+" : ""}{money(entry.amountCents)}</s-text></s-stack></s-box>) : <s-text color="subdued">Tus movimientos aparecerán aquí después de tu primera compra.</s-text>}
        </s-stack>
      </s-section>
    </s-stack>
  </s-page>;
}

function Metric({ label, value }) {
  return <s-box padding="base" border="base" borderRadius="base"><s-stack direction="block" gap="small-100"><s-text color="subdued">{label}</s-text><s-heading>{value}</s-heading></s-stack></s-box>;
}
