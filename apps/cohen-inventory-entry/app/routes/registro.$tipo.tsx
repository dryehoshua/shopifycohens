import type { ActionFunctionArgs, LinksFunction, MetaFunction } from "react-router";
import { Form, Link, useActionData, useParams } from "react-router";
import { useEffect, useState } from "react";
import stylesheet from "../nekudot-public.css?url";
import { RegistrationError, registerNekudot } from "../nekudot-registration.server";

const PAGE_OPTIONS = {
  plata: { title: "Nekudot Plata" },
  blue: { title: "Nekudot Blue" },
  golden: { title: "Nekudot Golden" },
  vales: { title: "Tarjeta de Vales" },
} as const;
type PageKind = keyof typeof PAGE_OPTIONS;
function pageKind(value: unknown): PageKind {
  const kind = String(value || "").toLowerCase();
  return kind in PAGE_OPTIONS ? kind as PageKind : "plata";
}

export const links: LinksFunction = () => [{ rel: "stylesheet", href: stylesheet }];
export const meta: MetaFunction = ({ params }) => [{ title: `${PAGE_OPTIONS[pageKind(params.tipo)].title} · Cohen's` }];

export async function action({ request, params }: ActionFunctionArgs) {
  try {
    return { ok: true as const, result: await registerNekudot(await request.formData(), params.tipo) };
  } catch (error) {
    const caught = error instanceof RegistrationError ? error : new RegistrationError("No se pudo completar el registro.", 500);
    return Response.json({ ok: false as const, error: caught.message }, { status: caught.status });
  }
}

function cardClass(tipo: string) {
  return tipo === "blue" ? " blue" : tipo === "golden" ? " golden" : tipo === "vales" ? " vales" : "";
}

export default function RegistrationPage() {
  const params = useParams();
  const tipo = pageKind(params.tipo);
  const option = PAGE_OPTIONS[tipo];
  const data = useActionData<typeof action>();
  const result = data?.ok ? data.result : null;
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview); }, [photoPreview]);
  const description = tipo === "plata"
    ? "Regístrate sin costo y recibe beneficios en tus compras Cohen's."
    : tipo === "blue"
      ? "Registro exclusivo con el código de tu IB. Tu cuenta quedará vinculada a la persona que presentó Cohen's a tu comunidad."
      : tipo === "golden"
        ? "Completa tus datos y activa tu suscripción de $300 MXN al mes para recibir el beneficio Golden de 8%."
        : "Crea tu tarjeta comunitaria; el saldo se asignará cuando reciba fondeo de patrocinadores.";

  return <main className="nk-shell">
    <header className="nk-brand"><span className="nk-mark">C</span><div><strong>Cohen&apos;s · Nekudot</strong><small>Beneficios que regresan a la comunidad</small></div></header>
    <div className="nk-grid">
      <section className="nk-panel">
        <p className="nk-eyebrow">Registro</p><h1>{option.title}</h1><p className="nk-lead">{description}</p>
        {result ? <div className="nk-status">{result.status === "PENDING_PAYMENT" ? "Tu cliente fue creado. La membresía Golden quedará activa al autorizar la suscripción mensual." : "Registro completado. Tu tarjeta digital ya está lista."} {result.ibName ? <>Tu IB es <strong>{result.ibName}</strong>. </> : null}{result.checkoutUrl ? <><a className="nk-button" href={result.checkoutUrl}>Activar suscripción Golden</a> </> : null}<Link to="/nekudot">Abrir Nekudot</Link>.</div> : <Form method="post" encType="multipart/form-data" className="nk-form">
          <label className="nk-field">Nombre<input name="firstName" required minLength={2} maxLength={60} autoComplete="given-name" /></label>
          <label className="nk-field">Apellidos<input name="lastName" required minLength={2} maxLength={80} autoComplete="family-name" /></label>
          <label className="nk-field full">Comunidad<input name="community" required minLength={2} maxLength={100} placeholder="Nombre de tu comunidad" /></label>
          <label className="nk-field">Teléfono móvil<input name="phone" required inputMode="tel" autoComplete="tel" placeholder="55 1234 5678" /></label>
          <label className="nk-field">Correo electrónico<input name="email" type="email" required autoComplete="email" /></label>
          {tipo === "blue" ? <label className="nk-field full">Código de tu IB<input name="ibCode" required autoCapitalize="characters" autoComplete="off" placeholder="Ej. BET-MIDRASH-CENTRO" /><small>Escribe la clave única que te entregó tu IB.</small></label> : null}
          <label className="nk-field full">Foto (opcional)<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
            if (photoPreview) URL.revokeObjectURL(photoPreview);
            setPhotoPreview(event.currentTarget.files?.[0] ? URL.createObjectURL(event.currentTarget.files[0]) : null);
          }} /></label>
          <label className="nk-honeypot" aria-hidden="true">Sitio web<input name="website" tabIndex={-1} autoComplete="off" /></label>
          <label className="nk-checkbox"><input name="privacy" type="checkbox" value="yes" required /> Acepto el aviso de privacidad y que mis datos se utilicen para administrar mi cuenta Nekudot y mis compras Cohen&apos;s.</label>
          {data && "error" in data && data.error ? <div className="nk-status error">{String(data.error)}</div> : null}
          <div className="nk-actions"><button className="nk-button">{tipo === "golden" ? "Registrar y continuar al pago" : "Crear mi tarjeta"}</button></div>
        </Form>}
      </section>
      <aside className={`nk-card${cardClass(tipo)}`}>
        <div className="nk-card-top"><div><p className="nk-eyebrow">Cohen&apos;s</p><div className="nk-tier">{option.title}</div></div>{photoPreview ? <img className="nk-photo" src={photoPreview} alt="Vista previa" /> : <div className="nk-photo nk-photo-placeholder">☺</div>}</div>
        <div className="nk-card-person"><h2>{result?.displayName || "Tu nombre"}</h2><p>{result?.community || "Tu comunidad"}</p></div>
        {result ? <><img className="nk-qr" src={result.qrDataUrl} alt="Código QR Nekudot" /><img className="nk-barcode" src={result.barcodeDataUrl} alt="Código de barras Nekudot" /><p className="nk-card-code">ID •••• {result.credentialLastFour}</p></> : <><div className="nk-qr" /><div className="nk-barcode nk-barcode-placeholder" /></>}
        <p className="nk-card-note">Presenta el QR o código de barras en los puntos de venta Cohen&apos;s.</p>
      </aside>
    </div>
  </main>;
}
