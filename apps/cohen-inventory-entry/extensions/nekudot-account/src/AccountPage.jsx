import { render } from "preact";
import { useState } from "preact/hooks";
import { LoadingOrError, money, postNekudotAction, tierLabel, useNekudotAccount } from "./shared.jsx";

const COMMUNITIES = ["Kehila Ashkenazi", "Maguen David", "Monte Sinai", "Comunidad Sefaradí", "Comunidad Bet El", "Beth Israel Community Center", "Jabad Lubavitch"];

export default async () => render(<AccountPage />, document.body);

function AccountPage() {
  const state = useNekudotAccount();
  const [activeSection, setActiveSection] = useState("nekudot");
  if (state.loading || state.error || !state.data?.registered) {
    return <s-page heading="Tarjeta Nekudot"><s-box padding="base"><LoadingOrError state={state} /></s-box></s-page>;
  }
  const { member, accruals, ledger, ibWallet, communityVoucher, portalUrl } = state.data;
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

      <s-section heading="Mi portal Cohen's">
        <s-stack direction="inline" gap="base">
          <s-button variant={activeSection === "nekudot" ? "primary" : "secondary"} onClick={() => setActiveSection("nekudot")}>Nekudot</s-button>
          <s-button variant={activeSection === "vales" ? "primary" : "secondary"} onClick={() => setActiveSection("vales")}>Vales comunitarios</s-button>
          <s-button variant={activeSection === "referidos" ? "primary" : "secondary"} onClick={() => setActiveSection("referidos")}>Programa de referidos</s-button>
        </s-stack>
      </s-section>

      {activeSection === "nekudot" ? <s-section heading={isVoucher ? "Mi tarjeta de vales" : "Mi tarjeta digital"}>
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
      </s-section> : null}

      {activeSection === "vales" ? <CommunityVoucherWallet wallet={communityVoucher} member={member} onReload={state.reload} /> : null}

      {activeSection === "referidos" ? (ibWallet ? <IbGoldWallet wallet={ibWallet} portalUrl={portalUrl} onReload={state.reload} /> : <ReferralActivation onReload={state.reload} />) : null}

      {activeSection === "nekudot" ? <s-section heading="Compras que generaron Nekudot">
        <s-stack direction="block" gap="small-200">
          {accruals.length ? accruals.map((item) => <s-box key={item.orderId} padding="base" border="base" borderRadius="base"><s-stack direction="inline" gap="base" justifyContent="space-between"><s-stack direction="block" gap="small-100"><s-text type="strong">{item.orderName}</s-text><s-text color="subdued">Compra acreditada</s-text></s-stack><s-text type="strong">+{money(item.clientEarnedCents)}</s-text></s-stack></s-box>) : <s-box padding="base" border="base" borderRadius="base"><s-text color="subdued">Aún no hay compras acreditadas.</s-text></s-box>}
        </s-stack>
      </s-section> : null}

      {activeSection === "nekudot" ? <s-section heading="Movimientos recientes">
        <s-stack direction="block" gap="small-200">
          {ledger.length ? ledger.map((entry) => <s-box key={entry.id} padding="base"><s-stack direction="inline" gap="base" justifyContent="space-between"><s-text>{entry.description}</s-text><s-text type="strong">{entry.amountCents >= 0 ? "+" : ""}{money(entry.amountCents)}</s-text></s-stack></s-box>) : <s-text color="subdued">Tus movimientos aparecerán aquí después de tu primera compra.</s-text>}
        </s-stack>
      </s-section> : null}
    </s-stack>
  </s-page>;
}

function CommunityVoucherWallet({ wallet, member, onReload }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function activate() {
    setBusy(true);
    setMessage("");
    try {
      await postNekudotAction("activate_community_voucher");
      setMessage("Tu tarjeta virtual de Vales comunitarios quedó activada.");
      onReload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No pudimos activar la tarjeta de vales.");
    } finally {
      setBusy(false);
    }
  }

  if (!wallet) return <s-section heading="Vales comunitarios">
    <s-stack direction="block" gap="base">
      <s-banner tone="info" heading="Tu tarjeta comunitaria todavía no está activa">
        Es un segundo monedero independiente para recibir apoyo comunitario y comprar exclusivamente en Cohen's. No se mezcla con tus Nekudot ni genera cashback.
      </s-banner>
      {message ? <s-banner tone="critical">{message}</s-banner> : null}
      <s-button variant="primary" disabled={busy} onClick={activate}>{busy ? "Activando…" : "Activar mis Vales comunitarios"}</s-button>
    </s-stack>
  </s-section>;

  return <s-section heading="Vales comunitarios">
    <s-stack direction="block" gap="base">
      <s-banner tone="success" heading={`${money(wallet.availableCents)} disponibles`}>
        Saldo independiente para comprar productos Cohen's. No es transferible, no genera cashback y no puede retirarse en efectivo.
      </s-banner>
      <s-box padding="large" border="base" borderRadius="large" background="subdued">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">COHEN'S · TARJETA VIRTUAL DE VALES</s-text>
          <s-heading>{member.displayName}</s-heading>
          <s-text type="strong">{wallet.cardNumber}</s-text>
          <s-stack direction="inline" gap="base">
            {wallet.qrDataUrl ? <s-image src={wallet.qrDataUrl} alt="QR de Vales comunitarios" inlineSize="128px" aspectRatio="1/1" borderRadius="base" /> : null}
            {wallet.barcodeDataUrl ? <s-image src={wallet.barcodeDataUrl} alt="Código de barras de Vales comunitarios" inlineSize="260px" aspectRatio="3/1" objectFit="contain" borderRadius="base" /> : null}
          </s-stack>
        </s-stack>
      </s-box>
    </s-stack>
  </s-section>;
}

function IbGoldWallet({ wallet, portalUrl, onReload }) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function submit(intent) {
    setBusy(intent);
    setMessage("");
    try {
      await postNekudotAction(intent, { amount });
      setMessage(intent === "ib_gold_to_store"
        ? "Tus Nekudot Gold ya están disponibles para comprar en Cohen's."
        : "Solicitud de retiro registrada. El saldo quedó reservado para revisión.");
      setAmount("");
      onReload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No pudimos completar la solicitud.");
    } finally {
      setBusy("");
    }
  }

  return <s-section heading="Mis Nekudot Gold · Programa IB">
    <s-stack direction="block" gap="base">
      <s-banner tone="info" heading={`Código IB: ${wallet.code}`}>
        Tus ganancias por referidos son Nekudot Gold: puedes convertirlas para comprar inmediatamente en Cohen's o solicitar su retiro en efectivo.
      </s-banner>
      <s-link href={`${String(portalUrl).replace(/\/apps\/nekudot\/?$/, "")}/apps/nekudot/registro/blue?ib=${encodeURIComponent(wallet.code)}`}>Abrir mi enlace para invitar clientes Blue</s-link>
      <s-grid gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))" gap="base">
        <Metric label="Gold disponibles" value={money(wallet.availableCents)} />
        <Metric label="Gold en retiro" value={money(wallet.reservedWithdrawalCents)} />
        <Metric label="Gold históricos" value={money(wallet.lifetimeCommissionCents)} />
        <Metric label="Personas referidas" value={String(wallet.referredClients.length)} />
      </s-grid>
      <s-section heading="Usar o retirar">
        <s-stack direction="block" gap="base">
          <s-text-field label="Cantidad (MXN)" value={amount} inputMode="decimal" placeholder="0.00" onInput={(event) => setAmount(event.currentTarget.value)} />
          <s-stack direction="inline" gap="base">
            <s-button variant="primary" disabled={Boolean(busy) || !amount} onClick={() => submit("ib_gold_to_store")}>{busy === "ib_gold_to_store" ? "Convirtiendo…" : "Usar en Cohen's"}</s-button>
            <s-button variant="secondary" disabled={Boolean(busy) || !amount} onClick={() => submit("ib_gold_withdrawal")}>{busy === "ib_gold_withdrawal" ? "Solicitando…" : "Solicitar retiro"}</s-button>
          </s-stack>
          {message ? <s-banner tone="info">{message}</s-banner> : null}
          <s-text color="subdued">Al elegir “Usar en Cohen's”, el importe pasa a tu saldo Nekudot para aplicarlo al carrito. Las solicitudes de efectivo quedan pendientes de validación y pago por administración.</s-text>
        </s-stack>
      </s-section>
      {wallet.withdrawals?.length ? <s-stack direction="block" gap="small-200">
        <s-heading>Solicitudes de retiro</s-heading>
        {wallet.withdrawals.map((item) => <s-box key={item.id} padding="base" border="base" borderRadius="base"><s-stack direction="inline" justifyContent="space-between" gap="base"><s-text>{money(item.amountCents)}</s-text><s-text>{item.status === "REQUESTED" ? "En revisión" : item.status}</s-text></s-stack></s-box>)}
      </s-stack> : null}
      <s-stack direction="block" gap="small-200">
        <s-heading>Mi red</s-heading>
        {wallet.referredClients.length ? wallet.referredClients.map((client) => <s-box key={client.id} padding="base" border="base" borderRadius="base"><s-stack direction="inline" gap="base" justifyContent="space-between"><s-stack direction="block" gap="small-100"><s-text type="strong">{client.displayName}</s-text><s-text color="subdued">{client.community || "Sin comunidad"} · {tierLabel(client.cardTier)}</s-text></s-stack><s-text>{client.active ? "Activo" : "Inactivo"}</s-text></s-stack></s-box>) : <s-text color="subdued">Todavía no hay personas vinculadas con tu código.</s-text>}
      </s-stack>
    </s-stack>
  </s-section>;
}

function ReferralActivation({ onReload }) {
  const [code, setCode] = useState("");
  const [community, setCommunity] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function activate() {
    setBusy(true);
    setMessage("");
    try {
      await postNekudotAction("activate_ib", { code, community });
      setMessage("Tu Programa de referidos quedó activo.");
      onReload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No pudimos activar el programa de referidos.");
    } finally {
      setBusy(false);
    }
  }

  return <s-section heading="Programa de referidos">
    <s-stack direction="block" gap="base">
      <s-banner tone="info" heading="Tu programa todavía no está activo">
        Actívalo gratis para compartir tu código. Las compras elegibles de tus referidos Blue generarán Nekudot Gold en un saldo separado.
      </s-banner>
      <s-text-field label="Elige tu código de referido" value={code} required placeholder="Ej. DAVID-01" onInput={(event) => setCode(event.currentTarget.value)} />
      <s-select label="Comunidad" value={community} required onChange={(event) => setCommunity(event.currentTarget.value)}>
        <s-option value="">Selecciona tu comunidad</s-option>
        {COMMUNITIES.map((item) => <s-option key={item} value={item}>{item}</s-option>)}
      </s-select>
      <s-text color="subdued">Al activarlo aceptas las condiciones del Programa de referidos Cohen's. Tus Nekudot personales y tus ganancias Gold permanecen separados.</s-text>
      {message ? <s-banner tone={message.includes("activo") ? "success" : "critical"}>{message}</s-banner> : null}
      <s-button variant="primary" disabled={busy || code.trim().length < 2 || !community} onClick={activate}>{busy ? "Activando…" : "Activar mi Programa de referidos"}</s-button>
    </s-stack>
  </s-section>;
}

function Metric({ label, value }) {
  return <s-box padding="base" border="base" borderRadius="base"><s-stack direction="block" gap="small-100"><s-text color="subdued">{label}</s-text><s-heading>{value}</s-heading></s-stack></s-box>;
}
