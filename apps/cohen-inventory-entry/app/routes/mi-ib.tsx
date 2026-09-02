import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, Link, redirect, useActionData, useLoaderData } from "react-router";
import stylesheet from "../nekudot-public.css?url";
import { NekudotPhoneField } from "../nekudot-phone-field";
import { NEKUDOT_ORIGIN, nekudotMeta } from "../nekudot-meta";
import { brokerDashboard, logoutBrokerPortal, portalBroker, RegistrationError, sendBrokerOtp, verifyBrokerOtp } from "../nekudot-registration.server";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: stylesheet }];
export const meta: MetaFunction = () => [
  ...nekudotMeta(
    "Portal de IB · Cohen's",
    "Consulta tus referidos, comisiones y actividad como IB de Cohen's.",
    "/og-portal-ib.png",
    "Portal de IB de Cohen's: referidos y comisiones",
  ),
  { property: "og:url", content: `${NEKUDOT_ORIGIN}/mi-ib` },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const broker = await portalBroker(request);
  if (!broker) return { authenticated: false as const };
  return { authenticated: true as const, dashboard: await brokerDashboard(broker.id) };
}

export async function action({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  try {
    const intent = String(form.get("intent") || "");
    if (intent === "send") return { ok: true as const, step: "code" as const, phone: (await sendBrokerOtp(form.get("phone"), form.get("countryCode"), form.get("customCountryCode"))).phone };
    if (intent === "verify") {
      const result = await verifyBrokerOtp(form.get("phone"), form.get("code"));
      return redirect("/mi-ib", { headers: { "Set-Cookie": result.cookie } });
    }
    if (intent === "logout") return redirect("/mi-ib", { headers: { "Set-Cookie": await logoutBrokerPortal(request) } });
    throw new RegistrationError("Operación no válida.");
  } catch (error) {
    const caught = error instanceof RegistrationError ? error : new RegistrationError("No se pudo completar el acceso IB.", 500);
    const retry = form.get("intent") === "verify"
      ? { step: "code" as const, phone: String(form.get("phone") || "") }
      : {};
    return Response.json({ ok: false as const, error: caught.message, ...retry }, { status: caught.status });
  }
}

function money(cents: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);
}

function tierLabel(tier: string) {
  return tier === "SILVER" ? "Plata" : tier === "BLUE" ? "Blue" : tier === "GOLDEN" ? "Golden" : "Vales";
}

export default function BrokerPortal() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.authenticated) {
    const phone = actionData && "step" in actionData && actionData.step === "code" ? actionData.phone : "";
    const phoneHint = phone ? `•••• ${phone.slice(-4)}` : "";
    return <main className="nk-login"><header className="nk-brand"><span className="nk-mark">C</span><div><strong>Cohen&apos;s · Portal IB</strong><small>Referidos y comisiones</small></div></header><section className="nk-panel">
      <p className="nk-eyebrow">Acceso privado</p><h1>Portal de IB</h1><p className="nk-lead">Este acceso es únicamente para IBs. Recibirás un código SMS en el teléfono registrado en tu perfil IB.</p>
      {phone ? <><p className="nk-otp-hint">Código enviado al número terminado en <strong>{phoneHint}</strong>.</p><Form method="post" className="nk-form"><input type="hidden" name="intent" value="verify" /><input type="hidden" name="phone" value={phone} /><label className="nk-field full">Código SMS<input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{4,10}" autoFocus /></label><div className="nk-actions"><button className="nk-button">Entrar</button></div></Form><div className="nk-otp-actions"><Form method="post"><input type="hidden" name="intent" value="send" /><input type="hidden" name="phone" value={phone} /><button className="nk-text-button" type="submit">Volver a enviar código</button></Form><Link className="nk-text-button" to="/mi-ib">Corregir número</Link></div></> : <Form method="post" className="nk-form"><input type="hidden" name="intent" value="send" /><NekudotPhoneField label="Teléfono móvil del IB" full /><div className="nk-actions"><button className="nk-button">Enviar código</button></div></Form>}
      {actionData && "error" in actionData && actionData.error ? <div className="nk-status error">{String(actionData.error)}</div> : null}
      <p><Link to="/nekudot">Soy beneficiario o tarjetahabiente</Link></p>
    </section></main>;
  }

  const { dashboard } = data;
  const activeClients = dashboard.clients.filter((client) => client.active).length;
  return <main className="nk-shell"><header className="nk-brand"><span className="nk-mark">C</span><div><strong>Cohen&apos;s · Portal IB</strong><small>Hola, {dashboard.displayName}</small></div></header><section className="nk-panel">
    <p className="nk-eyebrow">Panel de introducción comunitaria</p><h1>Tu red Cohen&apos;s</h1><p className="nk-lead">Aquí ves a las personas vinculadas mediante tu código IB y las comisiones generadas por sus compras.</p>
    <div className="nk-summary"><div className="nk-stat">Comisión disponible<strong>{money(dashboard.commissionBalanceCents)}</strong></div><div className="nk-stat">Comisión histórica<strong>{money(dashboard.lifetimeCommissionCents)}</strong></div><div className="nk-stat">Personas activas<strong>{activeClients}</strong></div><div className="nk-stat">Pagado al IB<strong>{money(dashboard.paidOutCents)}</strong></div></div>
    <div className="nk-ib-code"><span>Tu código para registros Blue</span><strong>{dashboard.code}</strong><small>Compártelo con las personas de los Beit Midrash y Beit Knesiot que introdujiste.</small></div>
    <h2>Personas bajo tu IB</h2><div className="nk-table-wrap"><table className="nk-table"><thead><tr><th>Persona</th><th>Comunidad</th><th>Tarjeta</th><th>Nekudot generados</th><th>Estado</th></tr></thead><tbody>{dashboard.clients.length ? dashboard.clients.map((client) => <tr key={client.id}><td><strong>{client.displayName}</strong></td><td>{client.community || "Sin comunidad"}</td><td><span className="nk-pill">{tierLabel(client.cardTier)}</span></td><td>{money(client.lifetimeEarnedCents)}</td><td>{client.active ? "Activo" : "Inactivo"}</td></tr>) : <tr><td colSpan={5}>Todavía no hay personas registradas con tu código.</td></tr>}</tbody></table></div>
    <h2>Movimientos de comisión</h2><div className="nk-ledger">{dashboard.ledger.length ? dashboard.ledger.map((entry) => <article className="nk-ledger-item" key={entry.id}><div><strong>{entry.description}</strong><br /><small>{new Date(entry.occurredAt).toLocaleDateString("es-MX")}</small></div><strong>{entry.amountCents >= 0 ? "+" : ""}{money(entry.amountCents)}</strong></article>) : <p>Aún no hay comisiones registradas.</p>}</div>
    <Form method="post"><input type="hidden" name="intent" value="logout" /><button className="nk-button secondary">Cerrar sesión</button></Form>
  </section></main>;
}
