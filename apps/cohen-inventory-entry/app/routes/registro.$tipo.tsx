import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data as responseData, Form, Link, useActionData, useLoaderData, useParams, useSearchParams } from "react-router";
import { useEffect, useState } from "react";
import stylesheet from "../nekudot-public.css?url";
import { NEKUDOT_COMMUNITIES } from "../nekudot-domain";
import { nekudotMeta } from "../nekudot-meta";
import { clearRegistrationCardPreview, RegistrationError, registerNekudot, registrationCardPreview } from "../nekudot-registration.server";

const PAGE_OPTIONS = {
  plata: {
    title: "Nekudot Plata",
    description: "Regístrate sin costo y recibe 2% de cashback en tus compras Cohen's.",
  },
  blue: {
    title: "Nekudot Blue",
    description: "Regístrate con el código de tu IB y recibe 5% de cashback en tus compras Cohen's.",
  },
  golden: {
    title: "Nekudot Golden",
    description: "Activa tu membresía Golden y recibe 8% de cashback en tus compras Cohen's.",
  },
  vales: {
    title: "Tarjeta de Vales",
    description: "Solicita tu tarjeta de apoyo comunitario Cohen's y consulta su saldo desde tu celular.",
  },
} as const;
type PageKind = keyof typeof PAGE_OPTIONS;
function pageKind(value: unknown): PageKind {
  const kind = String(value || "").toLowerCase();
  return kind in PAGE_OPTIONS ? kind as PageKind : "plata";
}

export const links: LinksFunction = () => [{ rel: "stylesheet", href: stylesheet }];
export const meta: MetaFunction = ({ params }) => {
  const option = PAGE_OPTIONS[pageKind(params.tipo)];
  return nekudotMeta(`${option.title} · Cohen's`, option.description);
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { preview, setCookie } = await registrationCardPreview(request, params.tipo);
  return responseData(preview, { headers: { "Set-Cookie": setCookie } });
}

export async function action({ request, params }: ActionFunctionArgs) {
  try {
    const result = await registerNekudot(await request.formData(), params.tipo);
    return responseData(
      { ok: true as const, result },
      { headers: { "Set-Cookie": clearRegistrationCardPreview(request, params.tipo) } },
    );
  } catch (error) {
    const caught = error instanceof RegistrationError ? error : new RegistrationError("No se pudo completar el registro.", 500);
    return Response.json({ ok: false as const, error: caught.message }, { status: caught.status });
  }
}

function cardClass(tipo: string) {
  return tipo === "blue" ? " blue" : tipo === "golden" ? " golden" : tipo === "vales" ? " vales" : " plata";
}

export default function RegistrationPage() {
  const params = useParams();
  const [searchParams] = useSearchParams();
  const tipo = pageKind(params.tipo);
  const option = PAGE_OPTIONS[tipo];
  const preview = useLoaderData<typeof loader>();
  const data = useActionData<typeof action>();
  const result = data?.ok ? data.result : null;
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [community, setCommunity] = useState("");
  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview); }, [photoPreview]);
  const liveName = `${firstName} ${lastName}`.trim();
  const referredIbCode = String(searchParams.get("ib") || "").slice(0, 40);
  const description = tipo === "plata"
    ? option.description
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
          <input type="hidden" name="registrationClaim" value={preview.claim} />
          <label className="nk-field">Nombre<input name="firstName" required minLength={2} maxLength={60} autoComplete="given-name" onChange={(event) => setFirstName(event.currentTarget.value)} /></label>
          <label className="nk-field">Apellidos<input name="lastName" required minLength={2} maxLength={80} autoComplete="family-name" onChange={(event) => setLastName(event.currentTarget.value)} /></label>
          <label className="nk-field full">Comunidad<select name="community" required defaultValue="" onChange={(event) => setCommunity(event.currentTarget.value)}><option value="" disabled>Selecciona tu comunidad</option>{NEKUDOT_COMMUNITIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label className="nk-field">Teléfono móvil<input name="phone" required inputMode="tel" autoComplete="tel" placeholder="55 1234 5678" /></label>
          <label className="nk-field">Correo electrónico<input name="email" type="email" required autoComplete="email" /></label>
          {tipo === "blue" ? <label className="nk-field full">Código de tu IB<input name="ibCode" required autoCapitalize="characters" autoComplete="off" placeholder="Ej. BET-MIDRASH-CENTRO" defaultValue={referredIbCode} /><small>Escribe la clave única que te entregó tu IB.</small></label> : null}
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
        <div className="nk-card-front" role="img" aria-label={`Frente físico de ${option.title}`} />
        <div className="nk-card-digital">
          <div className="nk-card-identity">
            {photoPreview ? <img className="nk-photo" src={photoPreview} alt="Vista previa" /> : <div className="nk-photo nk-photo-placeholder" aria-hidden="true">C</div>}
            <div className="nk-card-person" aria-live="polite"><span>Tarjeta digital · creando en vivo</span><h2>{result?.displayName || liveName || "Tu nombre"}</h2><p>{result?.community || community || "Tu comunidad"}</p></div>
          </div>
          <div className="nk-card-codes">
            <div className="nk-qr-wrap"><img className="nk-qr" src={result?.qrDataUrl || preview.qrDataUrl} alt="Código QR único Nekudot" /><small>QR único</small></div>
            <div className="nk-barcode-wrap"><img className="nk-barcode" src={result?.barcodeDataUrl || preview.barcodeDataUrl} alt="Código de barras Nekudot" /><p className="nk-card-code">{result?.cardNumber || preview.cardNumber}</p><small>Número de tarjeta</small></div>
          </div>
          <p className="nk-card-note">Presenta el QR o código de barras en los puntos de venta Cohen&apos;s.</p>
        </div>
      </aside>
    </div>
  </main>;
}
