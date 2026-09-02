import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import { Form, redirect, useActionData, useLoaderData } from "react-router";
import stylesheet from "../nekudot-public.css?url";
import { nekudotMeta } from "../nekudot-meta";
import { RegistrationError, logoutPortal, memberCardData, memberOrders, portalMember, sendPortalOtp, verifyPortalOtp } from "../nekudot-registration.server";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: stylesheet }];
export const meta: MetaFunction = () =>
  nekudotMeta(
    "Nekudot · Cohen's",
    "Abre tu tarjeta digital Cohen's y consulta tus puntos, saldo y compras.",
  );

export async function loader({ request }: LoaderFunctionArgs) {
  const member = await portalMember(request);
  if (!member) return { authenticated: false as const };
  const [card, orders] = await Promise.all([memberCardData(member.id), memberOrders(member.id)]);
  return { authenticated: true as const, card, orders };
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const form = await request.formData();
    const intent = String(form.get("intent") || "");
    if (intent === "send") return { ok: true as const, step: "code" as const, phone: (await sendPortalOtp(form.get("phone"))).phone };
    if (intent === "verify") {
      const result = await verifyPortalOtp(form.get("phone"), form.get("code"));
      return redirect("/nekudot", { headers: { "Set-Cookie": result.cookie } });
    }
    if (intent === "logout") return redirect("/nekudot", { headers: { "Set-Cookie": await logoutPortal(request) } });
    throw new RegistrationError("Operación no válida.");
  } catch (error) {
    const caught = error instanceof RegistrationError ? error : new RegistrationError("No se pudo completar el acceso.", 500);
    return Response.json({ ok: false as const, error: caught.message }, { status: caught.status });
  }
}

function money(cents: number) { return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100); }
function tierLabel(tier: string) { return tier === "SILVER" ? "Nekudot Plata" : tier === "BLUE" ? "Nekudot Blue" : tier === "GOLDEN" ? "Nekudot Golden" : "Tarjeta de Vales"; }
function cardTone(tier: string) { return tier === "BLUE" ? " blue" : tier === "GOLDEN" ? " golden" : tier === "VOUCHER" ? " vales" : " plata"; }

export default function MemberPortal() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  if (!data.authenticated) {
    const phone = actionData?.ok && actionData.step === "code" ? actionData.phone : "";
    return <main className="nk-login"><header className="nk-brand"><span className="nk-mark">C</span><div><strong>Cohen&apos;s</strong><small>Tu tarjeta, compras y puntos</small></div></header><section className="nk-panel">
      <p className="nk-eyebrow">Acceso sin contraseña</p><h1>Nekudot</h1><p className="nk-lead">Recibirás un código por SMS en el teléfono con el que te registraste.</p>
      {phone ? <Form method="post" className="nk-form"><input type="hidden" name="intent" value="verify" /><input type="hidden" name="phone" value={phone} /><label className="nk-field full">Código SMS<input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{4,10}" autoFocus /></label><div className="nk-actions"><button className="nk-button">Entrar</button></div></Form> : <Form method="post" className="nk-form"><input type="hidden" name="intent" value="send" /><label className="nk-field full">Teléfono móvil<input name="phone" required inputMode="tel" autoComplete="tel" placeholder="55 1234 5678" /></label><div className="nk-actions"><button className="nk-button">Enviar código</button></div></Form>}
      {actionData && "error" in actionData && actionData.error ? <div className="nk-status error">{String(actionData.error)}</div> : null}
    </section></main>;
  }
  const { card, orders } = data;
  return <main className="nk-shell"><header className="nk-brand"><span className="nk-mark">C</span><div><strong>Cohen&apos;s · Nekudot</strong><small>Hola, {card.displayName}</small></div></header><div className="nk-grid">
    <section className="nk-panel"><p className="nk-eyebrow">Resumen</p><h1>Tu cuenta</h1><div className="nk-summary"><div className="nk-stat">Saldo disponible<strong>{money(card.availableCents)}</strong></div><div className="nk-stat">Tarjeta<strong>{tierLabel(card.cardTier)}</strong></div></div>
      {card.enrollmentStatus === "PENDING_PAYMENT" ? <div className="nk-status">Tu membresía Golden está pendiente de confirmación de pago.</div> : null}
      <h2>Compras en Cohen&apos;s</h2><div className="nk-orders">{orders.length ? orders.map((order) => <article className="nk-order" key={order.id}><div><strong>{order.name}</strong><br /><small>{new Date(order.processedAt).toLocaleDateString("es-MX")} · {order.displayFinancialStatus} · {order.displayFulfillmentStatus}</small></div><strong>{new Intl.NumberFormat("es-MX", { style: "currency", currency: order.currentTotalPriceSet.shopMoney.currencyCode }).format(Number(order.currentTotalPriceSet.shopMoney.amount))}</strong></article>) : <p>Aún no hay compras vinculadas a esta cuenta.</p>}</div>
      <Form method="post"><input type="hidden" name="intent" value="logout" /><button className="nk-button secondary">Cerrar sesión</button></Form>
    </section>
    <aside className={`nk-card${cardTone(card.cardTier)}`}>
      <div className="nk-card-front" role="img" aria-label={`Frente físico de ${tierLabel(card.cardTier)}`} />
      <div className="nk-card-digital">
        <div className="nk-card-identity">
          {card.photoFileName ? <img className="nk-photo" src={`/nekudot-photo/${card.id}`} alt={card.displayName} /> : <div className="nk-photo nk-photo-placeholder" aria-hidden="true">C</div>}
          <div className="nk-card-person"><span>Tarjeta digital</span><h2>{card.displayName}</h2><p>{card.community || "Comunidad Cohen's"}</p><strong className="nk-card-balance">{money(card.availableCents)} disponibles</strong></div>
        </div>
        <div className="nk-card-codes">
          <div className="nk-qr-wrap"><img className="nk-qr" src={card.qrDataUrl} alt="Código QR único Nekudot" /><small>QR único</small></div>
          <div className="nk-barcode-wrap"><img className="nk-barcode" src={card.barcodeDataUrl} alt="Código de barras Nekudot" /><p className="nk-card-code">{card.cardNumber}</p><small>Número de tarjeta</small></div>
        </div>
        <p className="nk-card-note">Presenta el QR o código de barras en los puntos de venta Cohen&apos;s.</p>
      </div>
    </aside>
  </div></main>;
}
