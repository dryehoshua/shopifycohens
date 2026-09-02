import type { ActionFunctionArgs, LinksFunction, MetaFunction } from "react-router";
import { Form, Link, useActionData } from "react-router";
import { NEKUDOT_COMMUNITIES } from "../nekudot-domain";
import { nekudotMeta } from "../nekudot-meta";
import stylesheet from "../nekudot-public.css?url";
import { NekudotPhoneField } from "../nekudot-phone-field";
import { registerPublicBroker, RegistrationError } from "../nekudot-registration.server";

export const links: LinksFunction = () => [{ rel: "stylesheet", href: stylesheet }];
export const meta: MetaFunction = () =>
  nekudotMeta(
    "Únete como IB · Cohen's",
    "Comparte Cohen's con tu comunidad y gana el 5% de las compras elegibles de tus referidos Blue.",
    "/og-nekudot-ib.png?v=20260902b",
    "Programa IB Cohen's: liderazgo y crecimiento dentro de la comunidad",
  );

export async function action({ request }: ActionFunctionArgs) {
  try {
    return { ok: true as const, result: await registerPublicBroker(await request.formData()) };
  } catch (error) {
    const caught = error instanceof RegistrationError
      ? error
      : new RegistrationError("No se pudo completar tu registro como IB.", 500);
    return Response.json({ ok: false as const, error: caught.message }, { status: caught.status });
  }
}

export default function BrokerRegistrationPage() {
  const data = useActionData<typeof action>();
  const result = data?.ok ? data.result : null;

  return <main className="nk-shell nk-ib-landing">
    <header className="nk-brand nk-ib-nav">
      <span className="nk-mark">C</span>
      <div><strong>Cohen&apos;s · Programa IB</strong><small>Conecta, recomienda y crece</small></div>
      <Link className="nk-ib-login" to="/mi-ib">Entrar al portal</Link>
    </header>

    <section className="nk-ib-hero">
      <div className="nk-ib-pitch">
        <p className="nk-eyebrow">PROGRAMA DE INTRODUCTORES</p>
        <h1>Tu comunidad compra.<br /><em>Tú ganas el 5%.</em></h1>
        <p className="nk-ib-copy">Presenta Cohen&apos;s a tu Beit Midrash, Beit Kneset o comunidad. Comparte tu código personal y recibe una comisión por las compras elegibles de las personas que se registren contigo con tarjeta Blue.</p>
        <div className="nk-ib-rate"><strong>5%</strong><span>de comisión sobre las compras de tus referidos Blue</span></div>
        <div className="nk-ib-photo"><img src="/og-nekudot-ib.png" alt="Líderes del Programa IB Cohen's" /></div>
        <div className="nk-ib-steps">
          <article><b>1</b><div><strong>Regístrate</strong><p>Elige tu código único de referido.</p></div></article>
          <article><b>2</b><div><strong>Comparte</strong><p>Tus invitados se registran con tarjeta Blue y tu código.</p></div></article>
          <article><b>3</b><div><strong>Consulta</strong><p>Ve tu red y comisiones desde el portal IB.</p></div></article>
        </div>
      </div>

      <aside className="nk-panel nk-ib-form-card">
        {result ? <div className="nk-ib-success">
          <span className="nk-ib-check">✓</span>
          <p className="nk-eyebrow">PERFIL ACTIVO</p>
          <h2>¡Bienvenido, {result.displayName}!</h2>
          <p>Tu perfil IB ya está listo. Comparte este código o el enlace directo con tus referidos:</p>
          <div className="nk-ib-result"><small>Tu código de referido</small><strong>{result.code}</strong></div>
          <div className="nk-ib-success-actions">
            <Link className="nk-button" to={result.referralPath}>Abrir enlace para referidos</Link>
            <Link className="nk-button secondary" to="/mi-ib">Entrar a mi portal IB</Link>
          </div>
        </div> : <>
          <p className="nk-eyebrow">ALTA GRATUITA</p>
          <h2>Crea tu perfil IB</h2>
          <p className="nk-lead">Tu código vinculará automáticamente a cada cliente que invites.</p>
          <Form method="post" className="nk-form">
            <label className="nk-field full">Nombre completo<input name="displayName" required minLength={2} maxLength={100} autoComplete="name" /></label>
            <NekudotPhoneField />
            <label className="nk-field">Correo electrónico<input name="email" type="email" required autoComplete="email" /></label>
            <label className="nk-field full">Comunidad<select name="community" required defaultValue=""><option value="" disabled>Selecciona tu comunidad</option>{NEKUDOT_COMMUNITIES.map((community) => <option key={community} value={community}>{community}</option>)}</select></label>
            <label className="nk-field full">Código de referido<input name="code" required minLength={2} maxLength={40} autoCapitalize="characters" autoComplete="off" placeholder="Ej. DAVID-01" /><small>Será tu identificador público y el código que usarán tus clientes Blue al registrarse.</small></label>
            <label className="nk-honeypot" aria-hidden="true">Sitio web<input name="website" tabIndex={-1} autoComplete="off" /></label>
            <label className="nk-checkbox"><input name="privacy" type="checkbox" value="yes" required /> Acepto el aviso de privacidad y las condiciones del Programa IB de Cohen&apos;s.</label>
            {data && "error" in data && data.error ? <div className="nk-status error">{String(data.error)}</div> : null}
            <div className="nk-actions"><button className="nk-button">Crear mi perfil IB</button></div>
          </Form>
        </>}
      </aside>
    </section>

    <p className="nk-ib-disclaimer">Las comisiones corresponden únicamente a compras elegibles de clientes Blue vinculados a tu código. El cliente recibe 5% de cashback y su IB recibe otro 5%; pueden existir ajustes por cancelaciones o devoluciones.</p>
  </main>;
}
