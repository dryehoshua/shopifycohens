import { render } from "preact";
import { LoadingOrError, money, tierLabel, useNekudotAccount } from "./shared.jsx";

export default async () => render(<AccountPage />, document.body);

function AccountPage() {
  const state = useNekudotAccount();
  if (state.loading || state.error || !state.data?.registered) {
    return <s-page heading="Tarjeta Nekudot"><s-box padding="base"><LoadingOrError state={state} /></s-box></s-page>;
  }
  const { member, accruals, ledger, portalUrl } = state.data;
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
                {member.qrDataUrl ? <s-image src={member.qrDataUrl} alt="Código QR de la tarjeta Nekudot" inlineSize="128px" aspectRatio="1/1" borderRadius="base" /> : null}
              </s-stack>
              {member.barcodeDataUrl ? <s-image src={member.barcodeDataUrl} alt="Código de barras de la tarjeta Nekudot" inlineSize="100%" maxInlineSize="360px" aspectRatio="3/1" objectFit="contain" borderRadius="base" /> : null}
              <s-text color="subdued">Presenta el QR o el código de barras en caja. Tu NFC, QR y código de barras identifican la misma cuenta.</s-text>
            </s-stack>
          </s-box>
          {!isVoucher ? <s-button href={portalUrl} variant="primary">Usar Nekudot en una compra</s-button> : null}
        </s-stack>
      </s-section>

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
