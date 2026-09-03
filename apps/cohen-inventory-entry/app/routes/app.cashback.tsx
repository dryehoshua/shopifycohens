import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Form, useActionData, useLoaderData, useNavigation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { cashbackPercentForTier, formatNekudot } from "../nekudot-domain";
import {
  bindNekudotCredential,
  createNekudotBroker,
  listShopifyCustomers,
  listNekudotBrokers,
  lookupNekudotMember,
  nekudotDashboard,
  NekudotError,
  replaceNekudotCredential,
} from "../nekudot.server";
import { authenticate } from "../shopify.server";
import { NfcBridgeReader } from "../components/NfcBridgeReader";
import "../cashback.css";
import "../nfc-bridge.css";

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

type ActionData =
  | { ok: true; intent: string; message: string; member?: Awaited<ReturnType<typeof lookupNekudotMember>> }
  | { ok: false; intent: string; error: string; code?: string };

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [dashboard, brokers, customers] = await Promise.all([
    nekudotDashboard(),
    listNekudotBrokers(),
    listShopifyCustomers(admin),
  ]);
  return {
    shop: session.shop,
    search: "",
    customers,
    brokers: brokers.map((broker) => ({
      id: broker.id,
      code: broker.code,
      displayName: broker.displayName,
      email: broker.email,
      commissionBalanceCents: broker.commissionBalanceCents,
      lifetimeCommissionCents: broker.lifetimeCommissionCents,
      clientCount: broker._count.clients,
    })),
    metrics: dashboard.metrics,
    members: dashboard.recentMembers.map((member) => ({
      id: member.id,
      displayName: member.displayName,
      email: member.email,
      cardTier: member.cardTier,
      balanceCents: member.balanceCents,
      reservedCents: member.reservedCents,
      broker: member.broker ? { id: member.broker.id, displayName: member.broker.displayName, code: member.broker.code } : null,
      credentialCount: member.credentials.length,
      shops: member.identities.map((identity) => identity.shop),
      updatedAt: member.updatedAt.toISOString(),
    })),
    ledger: dashboard.recentLedger.map((entry) => ({
      id: entry.id,
      walletType: entry.walletType,
      type: entry.type,
      amountCents: entry.amountCents,
      balanceAfterCents: entry.balanceAfterCents,
      shop: entry.shop,
      source: entry.source,
      description: entry.description,
      occurredAt: entry.occurredAt.toISOString(),
      owner: entry.member?.displayName ?? entry.broker?.displayName ?? "Sin perfil",
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = field(formData, "intent");
  try {
    if (intent === "lookup") {
      const member = await lookupNekudotMember(session.shop, field(formData, "credential"));
      return Response.json({ ok: true, intent, message: `Membresía encontrada: ${member.displayName}.`, member } satisfies ActionData);
    }
    if (intent === "bind") {
      const rawToken = field(formData, "credential");
      await bindNekudotCredential({
        admin,
        shop: session.shop,
        customerId: field(formData, "customerId"),
        rawToken,
        kind: field(formData, "kind"),
        label: field(formData, "label"),
        brokerId: field(formData, "brokerId"),
        cardTier: field(formData, "cardTier"),
      });
      const member = await lookupNekudotMember(session.shop, rawToken);
      return Response.json({ ok: true, intent, message: `Tarjeta vinculada a ${member.displayName}.`, member } satisfies ActionData);
    }
    if (intent === "replace_card") {
      const rawToken = field(formData, "credential");
      await replaceNekudotCredential({
        admin,
        shop: session.shop,
        customerId: field(formData, "customerId"),
        rawToken,
        kind: field(formData, "kind"),
        label: field(formData, "label"),
        identityVerified: field(formData, "identityVerified"),
        cardTier: field(formData, "cardTier"),
      });
      const member = await lookupNekudotMember(session.shop, rawToken);
      return Response.json({
        ok: true,
        intent,
        message: `Tarjeta anterior desactivada. ${member.displayName} conserva todo su saldo en la nueva tarjeta.`,
        member,
      } satisfies ActionData);
    }
    if (intent === "create_broker") {
      const broker = await createNekudotBroker({
        code: field(formData, "code"),
        displayName: field(formData, "displayName"),
        email: field(formData, "email"),
        phone: field(formData, "phone"),
      });
      return Response.json({ ok: true, intent, message: `IB ${broker.displayName} listo con código ${broker.code}.` } satisfies ActionData);
    }
    throw new NekudotError("Acción no válida.", 405);
  } catch (error) {
    return Response.json({
      ok: false,
      intent,
      error: error instanceof Error ? error.message : "Error desconocido.",
      ...(error instanceof NekudotError ? { code: error.code } : {}),
    } satisfies ActionData, { status: error instanceof NekudotError ? error.status : 400 });
  }
};

type Tab = "overview" | "scan" | "customers" | "brokers" | "ledger";

function Icon({ name }: { name: "spark" | "scan" | "users" | "tag" | "book" }) {
  const paths = {
    spark: <path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z" />,
    scan: <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10" />,
    users: <path d="M16 20v-1.7c0-2.4-2.1-4.3-4.6-4.3H7.6C5.1 14 3 15.9 3 18.3V20M9.5 10.5A3.5 3.5 0 1 0 9.5 3a3.5 3.5 0 0 0 0 7.5ZM16 4.2a3.5 3.5 0 0 1 0 6.6M18 14.2c1.8.7 3 2.2 3 4.1V20" />,
    tag: <path d="M20 13.5 13.5 20a2 2 0 0 1-2.8 0L4 13.3V4h9.3l6.7 6.7a2 2 0 0 1 0 2.8ZM8.5 8.5h.01" />,
    book: <path d="M5 4h11a3 3 0 0 1 3 3v13H7a2 2 0 0 1-2-2V4Zm0 13.5A2.5 2.5 0 0 1 7.5 15H19M9 8h6" />,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" }).format(new Date(value));
}

export default function NekudotPage() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>() as ActionData | undefined;
  const navigation = useNavigation();
  const scannerRef = useRef<HTMLInputElement>(null);
  const scannerFormRef = useRef<HTMLFormElement>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [selectedCustomerId, setSelectedCustomerId] = useState(data.customers[0]?.id ?? "");
  const [customerFilter, setCustomerFilter] = useState("");
  const [scanCredential, setScanCredential] = useState("");
  const [bindCredential, setBindCredential] = useState("");
  const pendingIntent = String(navigation.formData?.get("intent") ?? "");
  const member = result?.ok ? result.member : undefined;
  const selectedCustomer = data.customers.find((customer) => customer.id === selectedCustomerId);
  const normalizedCustomerFilter = customerFilter.trim().toLocaleLowerCase("es-MX");
  const visibleCustomers = useMemo(() => data.customers.filter((customer) =>
    !normalizedCustomerFilter || [customer.displayName, customer.email ?? "", customer.phone ?? ""]
      .some((value) => value.toLocaleLowerCase("es-MX").includes(normalizedCustomerFilter)),
  ), [data.customers, normalizedCustomerFilter]);

  useEffect(() => {
    if (!result) return;
    if (result.intent === "create_broker") setTab("brokers");
    else if (result.intent === "bind" || result.intent === "replace_card") setTab("customers");
    else setTab("scan");
  }, [result]);
  useEffect(() => { if (tab === "scan") scannerRef.current?.focus(); }, [tab]);

  const tabs: Array<{ id: Tab; label: string; icon: "spark" | "scan" | "users" | "tag" | "book" }> = [
    { id: "overview", label: "Resumen", icon: "spark" },
    { id: "scan", label: "Escanear", icon: "scan" },
    { id: "customers", label: "Miembros", icon: "users" },
    { id: "brokers", label: "IBs", icon: "tag" },
    { id: "ledger", label: "Movimientos", icon: "book" },
  ];

  return <s-page heading="Nekudot Cohen's">
    <div className="cb-shell">
      <section className="cb-hero">
        <div className="cb-hero-copy"><span className="cb-eyebrow"><span /> NEKUDOT COHEN&apos;S</span><h1>Premiamos volver.<br />Reconocemos recomendar.</h1><p>Silver 2%, Blue 5% y Golden 8% de cashback; el IB conserva 5% de comisión de las personas vinculadas.</p></div>
        <div className="cb-hero-balance"><span>Nekudot disponibles</span><strong>{formatNekudot(data.metrics.balanceCents)}</strong><div className="cb-mini-progress"><i /></div><small>{data.metrics.members} miembros · 1 Nekuda = $1 MXN</small></div>
      </section>
      <nav className="cb-tabs" aria-label="Secciones de Nekudot">{tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} type="button" onClick={() => setTab(item.id)}><Icon name={item.icon} />{item.label}</button>)}</nav>
      {result ? <div className={`cb-alert ${result.ok ? "success" : "error"}`} role="status"><span>{result.ok ? "✓" : "!"}</span>{result.ok ? result.message : result.error}</div> : null}

      {tab === "overview" ? <div className="cb-overview">
        <section className="cb-metrics">
          <article className="cb-metric green"><span>Miembros</span><strong>{data.metrics.members}</strong><small>multitienda</small></article>
          <article className="cb-metric amber"><span>Saldo Nekudot</span><strong>{formatNekudot(data.metrics.balanceCents)}</strong><small>{formatNekudot(data.metrics.reservedCents)} reservado</small></article>
          <article className="cb-metric purple"><span>IBs</span><strong>{data.metrics.brokers}</strong><small>perfiles activos</small></article>
          <article className="cb-metric blue"><span>Comisiones</span><strong>{formatNekudot(data.metrics.commissionBalanceCents)}</strong><small>saldo por conciliar</small></article>
        </section>
        <section className="cb-overview-grid">
          <div className="cb-panel cb-how"><span className="cb-kicker">DINÁMICA DE CAJA</span><h2>Pregunta, identifica y acredita</h2><ol><li><span>1</span><div><strong>Pregunta</strong><p>Al terminar: “¿Tiene tarjeta Cohen&apos;s?”.</p></div></li><li><span>2</span><div><strong>Escanea</strong><p>RFID o QR localiza su perfil, nivel y saldo.</p></div></li><li><span>3</span><div><strong>Acredita</strong><p>El pedido pagado aplica 2%, 5% u 8% según la tarjeta.</p></div></li></ol><button className="cb-primary" type="button" onClick={() => setTab("scan")}>Abrir lector</button></div>
          <div className="cb-panel cb-status"><span className="cb-kicker">COBERTURA</span><h2>Tienda + cafetería</h2><div className="cb-status-line"><span className="ok">✓</span><div><strong>Wallet central</strong><small>Un saldo en las dos tiendas</small></div></div><div className="cb-status-line"><span className="ok">✓</span><div><strong>Compras y devoluciones</strong><small>Reconciliación automática</small></div></div><div className="cb-status-line"><span className="ok">✓</span><div><strong>Canje protegido</strong><small>Reserva hasta confirmar el pedido</small></div></div></div>
        </section>
        <Ledger entries={data.ledger.slice(0, 8)} />
      </div> : null}

      {tab === "scan" ? <section className="cb-panel cb-scan-layout">
        <div className="cb-scan-card"><div className="cb-section-heading"><span className="cb-icon"><Icon name="scan" /></span><div><h2>Leer tarjeta o QR</h2><p>El ID es el mismo en tienda y cafetería.</p></div></div><Form ref={scannerFormRef} method="post" className="cb-scan-form"><input type="hidden" name="intent" value="lookup" /><label htmlFor="nekudot-credential">ID Nekudot</label><div className="cb-input-action"><input id="nekudot-credential" ref={scannerRef} name="credential" value={scanCredential} onChange={(event) => setScanCredential(event.target.value)} required minLength={4} maxLength={128} autoComplete="off" placeholder="Esperando lectura…" /><button className="cb-primary" type="submit" disabled={pendingIntent === "lookup"}>{pendingIntent === "lookup" ? "Buscando…" : "Identificar"}</button></div></Form><NfcBridgeReader onCredential={(credential) => { setScanCredential(credential); window.requestAnimationFrame(() => scannerFormRef.current?.requestSubmit()); }} /><div className="cb-reader-visual" aria-hidden="true"><div className="cb-card-chip"><i /><i /><i /><i /></div><div className="cb-radio">)))</div><div className="cb-qr-grid">{Array.from({ length: 25 }).map((_, index) => <i key={index} />)}</div></div></div>
        {member ? <div className="cb-account-card"><div className="cb-account-head"><span className="cb-avatar large">{member.displayName.slice(0, 2).toUpperCase()}</span><div><span className="cb-kicker">MIEMBRO ENCONTRADO</span><h2>{member.displayName}</h2><p>{member.email ?? "Sin correo"} · {member.cardTier} · {cashbackPercentForTier(member.cardTier)}%</p></div><span className="cb-live">ACTIVA</span></div><div className="cb-balance-box"><span>Disponible para nuevas compras</span><strong>{formatNekudot(member.availableCents)}</strong><small>{formatNekudot(member.reservedCents)} reservado</small></div><div className="cb-account-stats"><span><small>Ganado</small><strong>{formatNekudot(member.lifetimeEarnedCents)}</strong></span><span><small>Canjeado</small><strong>{formatNekudot(member.lifetimeRedeemedCents)}</strong></span><span><small>IB</small><strong>{member.broker?.displayName ?? "Sin IB"}</strong></span></div><div className="cb-order-note"><span>i</span><p>En Shopify POS usa el mosaico “Nekudot Cohen&apos;s” para asignar este cliente al carrito y aplicar su saldo.</p></div></div> : <div className="cb-empty-account"><span><Icon name="users" /></span><h3>Lista para leer</h3><p>La membresía mostrará tipo de tarjeta, saldo, IB e identidades de ambas tiendas.</p></div>}
      </section> : null}

      {tab === "customers" ? <section className="cb-panel"><div className="cb-panel-title"><div><span className="cb-kicker">MIEMBROS</span><h2>Vincular cliente de Shopify</h2><p>La lista se carga automáticamente; escribe sólo para filtrarla.</p></div><span className="cb-count">Silver 2% · Blue 5% · Golden 8%</span></div><div className="cb-search"><span>⌕</span><input value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)} placeholder="Filtrar por nombre, teléfono o correo…" /></div>
        <div className="cb-customer-workspace"><div className="cb-customer-results"><h3>Clientes ({visibleCustomers.length})</h3>{visibleCustomers.map((customer) => <button key={customer.id} type="button" className={`cb-customer-result ${selectedCustomerId === customer.id ? "selected" : ""}`} onClick={() => setSelectedCustomerId(customer.id)}><span className="cb-avatar">{customer.displayName.slice(0, 2).toUpperCase()}</span><span><strong>{customer.displayName}</strong><small>{customer.phone ?? customer.email ?? "Sin contacto"} · {customer.numberOfOrders} pedidos</small></span><i>{selectedCustomerId === customer.id ? "✓" : "›"}</i></button>)}</div><div className="cb-bind-card"><span className="cb-kicker">TARJETA NEKUDOT</span><h3>{selectedCustomer?.displayName ?? "Selecciona un cliente"}</h3><p>El tipo de tarjeta determina el cashback de las compras nuevas.</p><Form method="post"><input type="hidden" name="customerId" value={selectedCustomer?.id ?? ""} /><label>ID leído<input name="credential" value={bindCredential} onChange={(event) => setBindCredential(event.target.value)} required minLength={4} maxLength={128} placeholder="Escanea aquí" /></label><NfcBridgeReader compact onCredential={setBindCredential} /><label>Tipo de tarjeta<select name="cardTier" defaultValue="" required><option value="" disabled>Selecciona el tipo</option><option value="SILVER">Silver · 2%</option><option value="BLUE">Blue · 5%</option><option value="GOLDEN">Golden · 8%</option></select></label><label>Formato<select name="kind" defaultValue="NFC"><option value="NFC">Tarjeta NFC</option><option value="QR">QR</option><option value="BARCODE">Código de barras</option><option value="RFID_OR_QR">Lector compatible anterior</option></select></label><label>Broker<select name="brokerId" defaultValue=""><option value="">Sin broker</option>{data.brokers.map((broker) => <option key={broker.id} value={broker.id}>{broker.displayName} · {broker.code}</option>)}</select></label><label>Etiqueta<input name="label" maxLength={80} placeholder="Tarjeta principal" /></label><button name="intent" value="bind" className="cb-primary cb-full" type="submit" disabled={!selectedCustomer || Boolean(pendingIntent)}>{pendingIntent === "bind" ? "Vinculando…" : "Crear / vincular"}</button><div className="cb-replace"><label className="cb-check"><input type="checkbox" name="identityVerified" value="yes" /><span>Verifiqué personalmente la identificación del cliente.</span></label><button name="intent" value="replace_card" className="cb-danger cb-full" type="submit" disabled={!selectedCustomer || Boolean(pendingIntent)}>{pendingIntent === "replace_card" ? "Reemplazando…" : "Reemplazar tarjeta perdida"}</button><small>La tarjeta anterior quedará inutilizable; el saldo se conserva y el tipo seleccionado queda activo.</small></div></Form></div></div>
        <div className="cb-subheading"><h3>Miembros recientes</h3><span>{data.members.length}</span></div><div className="cb-member-grid">{data.members.map((item) => <article className="cb-member" key={item.id}><span className="cb-avatar">{item.displayName.slice(0, 2).toUpperCase()}</span><div><strong>{item.displayName}</strong><small>{item.cardTier} · {cashbackPercentForTier(item.cardTier)}% · {item.broker ? `Broker: ${item.broker.displayName}` : "Sin broker"}</small></div><div className="cb-member-balance"><strong>{formatNekudot(item.balanceCents - item.reservedCents)}</strong><small>{item.credentialCount} ID</small></div></article>)}</div>
      </section> : null}

      {tab === "brokers" ? <section className="cb-panel"><div className="cb-panel-title"><div><span className="cb-kicker">IBS</span><h2>Perfiles IB y comisión 5%</h2></div><span className="cb-count">{data.brokers.length} activos</span></div><div className="cb-customer-workspace"><div className="cb-bind-card"><span className="cb-kicker">NUEVO IB</span><h3>Crear perfil</h3><p>Cada IB recibe un código único para vincular a las personas que introduce.</p><Form method="post"><input type="hidden" name="intent" value="create_broker" /><label>Nombre<input name="displayName" required minLength={2} /></label><label>Código único<input name="code" required minLength={2} placeholder="EJ. DAVID-01" /></label><label>Correo<input name="email" type="email" /></label><label>Teléfono para OTP<input name="phone" required inputMode="tel" /></label><button className="cb-primary cb-full" type="submit" disabled={pendingIntent === "create_broker"}>{pendingIntent === "create_broker" ? "Guardando…" : "Guardar IB"}</button></Form></div><div className="cb-customer-results"><h3>Comisiones por pagar</h3>{data.brokers.map((broker) => <div className="cb-customer-result" key={broker.id}><span className="cb-avatar">{broker.displayName.slice(0, 2).toUpperCase()}</span><span><strong>{broker.displayName} · {broker.code}</strong><small>{broker.clientCount} personas · histórico {formatNekudot(broker.lifetimeCommissionCents)}</small></span><i>{formatNekudot(broker.commissionBalanceCents)}</i></div>)}</div></div></section> : null}
      {tab === "ledger" ? <Ledger entries={data.ledger} /> : null}
    </div>
  </s-page>;
}

function Ledger({ entries }: { entries: ReturnType<typeof useLoaderData<typeof loader>>["ledger"] }) {
  return <section className="cb-panel cb-ledger"><div className="cb-panel-title"><div><span className="cb-kicker">LIBRO MAYOR</span><h2>Cashback y comisiones</h2></div><span className="cb-count">{entries.length} movimientos</span></div>{entries.length === 0 ? <div className="cb-search-prompt"><Icon name="book" /><p>Los primeros movimientos aparecerán aquí.</p></div> : <div className="cb-table-wrap"><table><thead><tr><th>Fecha</th><th>Perfil</th><th>Wallet</th><th>Concepto</th><th>Tienda</th><th>Movimiento</th><th>Saldo</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.id}><td>{dateTime(entry.occurredAt)}</td><td><strong>{entry.owner}</strong></td><td><span className={`cb-type ${entry.walletType === "BROKER" ? "adjustment" : ""}`}>{entry.walletType === "BROKER" ? "Broker" : "Cliente"}</span></td><td><small>{entry.description}</small></td><td>{entry.shop ?? "—"}</td><td className={entry.amountCents >= 0 ? "positive" : "negative"}>{entry.amountCents > 0 ? "+" : ""}{formatNekudot(entry.amountCents)}</td><td>{formatNekudot(entry.balanceAfterCents)}</td></tr>)}</tbody></table></div>}</section>;
}

export function ErrorBoundary() { return boundary.error(useRouteError()); }
export const headers: HeadersFunction = (args) => boundary.headers(args);
