import type { ActionFunctionArgs, LinksFunction, LoaderFunctionArgs, MetaFunction } from "react-router";
import { data as responseData, Form, redirect, useActionData, useLoaderData, useParams, useSearchParams } from "react-router";
import { useEffect, useRef, useState } from "react";
import stylesheet from "../nekudot-public.css?url";
import { NEKUDOT_COMMUNITIES } from "../nekudot-domain";
import { nekudotMeta } from "../nekudot-meta";
import { NekudotPhoneField } from "../nekudot-phone-field";
import {
  clearRegistrationCardPreview,
  findRegistrationMatches,
  RegistrationError,
  registerNekudot,
  registrationCardPreview,
  sendExistingRegistrationOtp,
  verifyExistingRegistrationOtp,
} from "../nekudot-registration.server";

const PAGE_OPTIONS = {
  plata: {
    title: "Nekudot Plata",
    description: "Regístrate sin costo y recibe 2% de cashback en tus compras Cohen's.",
    socialTitle: "Cohen's Plata",
    socialImage: "/og-nekudot-plata.png?v=20260902b",
    socialAlt: "Cohen's Plata: beneficios cotidianos en una experiencia luminosa y cercana",
  },
  blue: {
    title: "Nekudot Blue",
    description: "Regístrate con el código de tu IB y recibe 5% de cashback en tus compras Cohen's.",
    socialTitle: "Cohen's Blue",
    socialImage: "/og-nekudot-blue.png?v=20260902b",
    socialAlt: "Cohen's Blue: más compras gracias a tu cashback",
  },
  golden: {
    title: "Nekudot Golden",
    description: "Activa tu membresía Golden y recibe 8% de cashback en tus compras Cohen's.",
    socialTitle: "Cohen's Golden",
    socialImage: "/og-nekudot-golden.png?v=20260902b",
    socialAlt: "Cohen's Golden: beneficios premium con 8% de cashback",
  },
  vales: {
    title: "Tarjeta de Vales",
    description: "Solicita tu tarjeta de apoyo comunitario Cohen's y consulta su saldo desde tu celular.",
    socialTitle: "Cohen's Vales",
    socialImage: "/og-nekudot-vales.png?v=20260902b",
    socialAlt: "Cohen's Vales: apoyo comunitario para la despensa familiar",
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
  return nekudotMeta(option.socialTitle, option.description, option.socialImage, option.socialAlt);
};

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { preview, setCookie } = await registrationCardPreview(request, params.tipo);
  return responseData(preview, { headers: { "Set-Cookie": setCookie } });
}

export async function action({ request, params }: ActionFunctionArgs) {
  const form = await request.formData();
  const intent = String(form.get("intent") || "review");
  try {
    if (intent === "verify-existing") {
      const result = await verifyExistingRegistrationOtp(form.get("matchToken"), form.get("code"));
      return responseData({ ok: true as const, step: "linked" as const }, { headers: { "Set-Cookie": result.cookie } });
    }

    if (intent === "choose-existing" && String(form.get("existingMatch") || "") !== "none") {
      const challenge = await sendExistingRegistrationOtp(form.get("existingMatch"));
      return { ok: true as const, step: "verify-existing" as const, ...challenge };
    }

    if (intent === "review") {
      const review = await findRegistrationMatches(form, params.tipo);
      if (review.matches.length) return { ok: true as const, step: "matches" as const, ...review };
    }

    const result = await registerNekudot(form, params.tipo);
    return responseData(
      { ok: true as const, step: "complete" as const, result },
      { headers: { "Set-Cookie": clearRegistrationCardPreview(request, params.tipo) } },
    );
  } catch (error) {
    const caught = error instanceof RegistrationError ? error : new RegistrationError("No se pudo completar el registro.", 500);
    if (intent === "choose-existing" || (intent === "review" && caught.status === 409)) {
      try {
        const review = await findRegistrationMatches(form, params.tipo);
        return Response.json({ ok: false as const, step: "matches" as const, error: caught.message, ...review }, { status: caught.status });
      } catch {
        // Fall through to the regular error response when the submitted form is no longer valid.
      }
    }
    const retry = intent === "verify-existing"
      ? { step: "verify-existing" as const, matchToken: String(form.get("matchToken") || ""), phoneHint: String(form.get("phoneHint") || "") }
      : {};
    return Response.json({ ok: false as const, error: caught.message, ...retry }, { status: caught.status });
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
  const result = data?.ok && data.step === "complete" ? data.result : null;
  const matchReview = data && data.step === "matches" ? data : null;
  const verification = data && data.step === "verify-existing" ? data : null;
  const submitted = matchReview?.submitted;
  const matchesRef = useRef<HTMLFieldSetElement>(null);
  const [selectedMatch, setSelectedMatch] = useState("");
  const selectedAccount = matchReview?.matches.find((match) => match.token === selectedMatch);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [community, setCommunity] = useState("");
  useEffect(() => () => { if (photoPreview) URL.revokeObjectURL(photoPreview); }, [photoPreview]);
  useEffect(() => {
    if (window.parent === window) return;
    const shell = document.querySelector(".nk-shell");
    if (!shell) return;
    const reportSize = () => window.parent.postMessage({ type: "cohens-registration-size", height: Math.ceil(shell.getBoundingClientRect().height) }, "https://cohenskosher.com");
    const observer = new ResizeObserver(reportSize);
    observer.observe(shell);
    reportSize();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!matchReview) return;
    setSelectedMatch("");
    matchesRef.current?.focus();
    matchesRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [matchReview]);
  useEffect(() => {
    if (!result || result.checkoutUrl) return;
    const timer = window.setTimeout(() => window.top?.location.assign("https://cohenskosher.com/apps/nekudot"), 1800);
    return () => window.clearTimeout(timer);
  }, [result]);
  useEffect(() => {
    if (data?.ok && data.step === "linked") window.top?.location.assign("https://cohenskosher.com/apps/nekudot");
  }, [data]);
  const liveName = `${firstName} ${lastName}`.trim() || (submitted ? `${submitted.firstName} ${submitted.lastName}` : "");
  const referredIbCode = submitted?.ibCode || String(searchParams.get("ib") || "").slice(0, 40);
  const description = tipo === "plata"
    ? option.description
    : tipo === "blue"
      ? "Registro exclusivo con el código de tu IB. Tu cuenta quedará vinculada a la persona que presentó Cohen's a tu comunidad."
      : tipo === "golden"
        ? "Completa tus datos y activa tu suscripción de $300 MXN al mes para recibir el beneficio Golden de 8%."
        : "Crea tu tarjeta comunitaria; el saldo se asignará cuando reciba fondeo de patrocinadores.";

  if (data?.ok && data.step === "linked") return <main className="nk-shell"><section className="nk-panel"><h1>Cuenta confirmada</h1><p>Tu tarjeta y tus puntos se conservan. Continúa en tu cuenta Cohen's.</p><a className="nk-button" href="https://cohenskosher.com/apps/nekudot" target="_top">Abrir mi cuenta Cohen's</a></section></main>;

  return <main className="nk-shell">
    <header className="nk-brand"><span className="nk-mark">C</span><div><strong>Cohen&apos;s · Nekudot</strong><small>Beneficios que regresan a la comunidad</small></div></header>
    <div className="nk-grid">
      <section className="nk-panel">
        <p className="nk-eyebrow">Registro</p><h1>{option.title}</h1><p className="nk-lead">{description}</p>
        {tipo === "golden" ? <div className="nk-status"><p>¿Ya tienes Plata, Blue o Vales? Contrata Golden desde tu misma cuenta. Cuando se active, Plata y Blue quedarán anuladas; tus puntos y vales se conservan.</p><a className="nk-button" href="https://cohenskosher.com/apps/nekudot#golden" target="_top">Ya tengo cuenta · Elegir Golden</a></div> : null}
        {result ? <div className="nk-status">{result.status === "PENDING_PAYMENT" ? "Tu cliente fue creado. La membresía Golden quedará activa al autorizar la suscripción mensual." : "Registro completado. Tu tarjeta digital ya está lista; te llevaremos a tu cuenta Cohen's."} {result.ibName ? <>Tu IB es <strong>{result.ibName}</strong>. </> : null}{result.checkoutUrl ? <><a className="nk-button" href={result.checkoutUrl} target="_top">Activar suscripción Golden</a> </> : <a className="nk-button" href="https://cohenskosher.com/apps/nekudot" target="_top">Abrir mi cuenta Cohen&apos;s</a>}</div> : verification ? <div className="nk-existing-verify">
          <p className="nk-eyebrow">CONFIRMA TU CUENTA</p><h2>Te enviamos un código</h2><p className="nk-lead">Escríbelo para abrir de forma segura el registro cuyo teléfono termina en {verification.phoneHint}.</p>
          <Form method="post" className="nk-form"><input type="hidden" name="intent" value="verify-existing" /><input type="hidden" name="matchToken" value={verification.matchToken} /><input type="hidden" name="phoneHint" value={verification.phoneHint} /><label className="nk-field full">Código SMS<input name="code" required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{4,10}" /></label>{data && "error" in data && data.error ? <div className="nk-status error">{String(data.error)}</div> : null}<div className="nk-actions"><button className="nk-button">Confirmar y abrir mis puntos</button></div></Form>
        </div> : <Form method="post" encType="multipart/form-data" className="nk-form">
          <input type="hidden" name="registrationClaim" value={preview.claim} />
          <label className="nk-field">Nombre<input name="firstName" required minLength={2} maxLength={60} autoComplete="given-name" defaultValue={submitted?.firstName} onChange={(event) => setFirstName(event.currentTarget.value)} /></label>
          <label className="nk-field">Apellidos<input name="lastName" required minLength={2} maxLength={80} autoComplete="family-name" defaultValue={submitted?.lastName} onChange={(event) => setLastName(event.currentTarget.value)} /></label>
          <label className="nk-field full">Comunidad<select name="community" required defaultValue={submitted?.community || ""} onChange={(event) => setCommunity(event.currentTarget.value)}><option value="" disabled>Selecciona tu comunidad</option>{NEKUDOT_COMMUNITIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <NekudotPhoneField full defaultPhone={submitted?.phone} />
          <label className="nk-field full">Correo electrónico <small>{tipo === "golden" ? "(necesario para el pago)" : "(opcional)"}</small><input name="email" type="email" required={tipo === "golden"} autoComplete="email" defaultValue={submitted?.email} /></label>
          {tipo === "blue" ? <label className="nk-field full">Palabra o clave de tu IB<input name="ibCode" required autoCapitalize="characters" autoComplete="off" placeholder="Ej. BET-MIDRASH-CENTRO" defaultValue={referredIbCode} /><small>Escribe la palabra o clave que te entregó tu IB.</small></label> : null}
          <label className="nk-field full">Foto (opcional)<input name="photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
            if (photoPreview) URL.revokeObjectURL(photoPreview);
            setPhotoPreview(event.currentTarget.files?.[0] ? URL.createObjectURL(event.currentTarget.files[0]) : null);
          }} /></label>
          <label className="nk-honeypot" aria-hidden="true">Sitio web<input name="website" tabIndex={-1} autoComplete="off" /></label>
          <label className="nk-checkbox"><input name="privacy" type="checkbox" value="yes" required /> Acepto el aviso de privacidad y que mis datos se utilicen para administrar mi cuenta Nekudot y mis compras Cohen&apos;s.</label>
          {matchReview ? <fieldset className="nk-existing-matches" ref={matchesRef} tabIndex={-1}><legend>¿Alguna de estas cuentas es tuya?</legend><p>Encontramos coincidencias con tu teléfono o correo. Selecciona tu cuenta para conservar tu tarjeta y tus puntos.</p>{matchReview.matches.map((match) => <label key={match.token}><input type="radio" name="existingMatch" value={match.token} checked={selectedMatch === match.token} onChange={() => setSelectedMatch(match.token)} aria-label={`Seleccionar cuenta ${match.name}`} required /><span><strong>{match.name}</strong><small>{match.phone}{match.email ? ` · ${match.email}` : ""}</small></span></label>)}<label><input type="radio" name="existingMatch" value="none" checked={selectedMatch === "none"} onChange={() => setSelectedMatch("none")} required /><span><strong>No soy ninguna de estas personas</strong><small>Revisa tu correo y teléfono arriba antes de continuar.</small></span></label>{selectedAccount ? <div role="status"><strong>¿Confirmas que eres {selectedAccount.name}?</strong><p>{selectedAccount.requiresLogin ? "Esta cuenta no tiene teléfono registrado. Confirma tu correo iniciando sesión en Cohen's y completa tu perfil en Tarjeta Nekudot." : "Al confirmar te enviaremos un código al teléfono registrado para proteger tu saldo."}</p>{selectedAccount.requiresLogin ? <a className="nk-button" href="https://cohenskosher.com/customer_authentication/login?return_to=%2Faccount" target="_top">Sí, soy yo · confirmar con mi correo</a> : null}</div> : null}</fieldset> : null}
          {data && "error" in data && data.error ? <div className="nk-status error">{String(data.error)}</div> : null}
          <div className="nk-actions"><button className="nk-button" disabled={Boolean(matchReview && (!selectedMatch || selectedAccount?.requiresLogin))} name="intent" value={matchReview ? "choose-existing" : "review"}>{selectedAccount ? "Sí, soy yo · continuar" : matchReview ? "Revisar mis datos y continuar" : tipo === "golden" ? "Registrar y continuar al pago" : "Crear mi tarjeta"}</button></div>
        </Form>}
      </section>
      <aside className={`nk-card${cardClass(tipo)}`}>
        <div className="nk-card-front" role="img" aria-label={`Frente físico de ${option.title}`} />
        <div className="nk-card-digital">
          <div className="nk-card-identity">
            {photoPreview ? <img className="nk-photo" src={photoPreview} alt="Vista previa" /> : <div className="nk-photo nk-photo-placeholder" aria-hidden="true">C</div>}
            <div className="nk-card-person" aria-live="polite"><span>Tarjeta digital · creando en vivo</span><h2>{result?.displayName || liveName || "Tu nombre"}</h2><p>{result?.community || community || submitted?.community || "Tu comunidad"}</p></div>
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
