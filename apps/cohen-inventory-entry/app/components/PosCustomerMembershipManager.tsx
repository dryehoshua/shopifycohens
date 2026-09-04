import { useEffect, useRef, useState } from "react";
import { NfcBridgeReader } from "./NfcBridgeReader";
import type { PosCustomerRecord } from "./PosCustomerProfileEditor";
import type { NekudotCardTier } from "../nekudot-domain";

type Credential = {
  id: string;
  kind: string;
  label: string | null;
  lastFour: string;
  active: boolean;
  createdAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  removable: boolean;
};

type Membership = {
  id: string;
  displayName: string;
  cardTier: NekudotCardTier;
  cashbackBasisPoints: number;
  availableCents: number;
  balanceCents: number;
  reservedCents: number;
  broker: { displayName: string; code: string } | null;
  photoUrl: string | null;
  qrDataUrl: string;
  barcodeDataUrl: string;
  cardNumber: string;
  credentials: Credential[];
};

type DetailsResponse = {
  customer: PosCustomerRecord;
  membership: Membership | null;
  message?: string;
};

function money(cents: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(cents / 100);
}

function tierLabel(tier: NekudotCardTier) {
  return tier === "SILVER" ? "Plata" : tier === "BLUE" ? "Blue" : tier === "GOLDEN" ? "Golden" : "Vales";
}

function credentialLabel(kind: string) {
  if (kind === "QR") return "QR digital";
  if (kind === "BARCODE") return "Código de barras";
  if (kind === "RFID") return "Tarjeta NFC / RFID";
  return "Tarjeta física";
}

async function post<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(result.error || "No se pudo completar la operación.");
  return result;
}

export function PosCustomerMembershipManager({
  customer,
  endpoint,
  staffRole,
  onCustomerUpdated,
  onMessage,
}: {
  customer: PosCustomerRecord;
  endpoint: string;
  staffRole?: string;
  onCustomerUpdated(customer: PosCustomerRecord): void;
  onMessage(message: { tone: string; text: string }): void;
}) {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tier, setTier] = useState<NekudotCardTier>(customer.profile?.cardTier || "SILVER");
  const [blueCode, setBlueCode] = useState(customer.profile?.blueAffiliationCode || "");
  const [credential, setCredential] = useState("");
  const [label, setLabel] = useState("Tarjeta física Cohen's");
  const [replace, setReplace] = useState(false);
  const [identityVerified, setIdentityVerified] = useState(false);
  const customerUpdatedRef = useRef(onCustomerUpdated);
  customerUpdatedRef.current = onCustomerUpdated;

  async function load() {
    setError("");
    const result = await post<DetailsResponse>(endpoint, { intent: "membershipDetails", customerId: customer.id });
    setMembership(result.membership);
    if (result.membership) {
      setTier(result.membership.cardTier);
      setBlueCode(result.membership.broker?.code || "");
    }
    onCustomerUpdated(result.customer);
    setLoaded(true);
  }

  useEffect(() => {
    let active = true;
    setLoaded(false);
    post<DetailsResponse>(endpoint, { intent: "membershipDetails", customerId: customer.id })
      .then((result) => {
        if (!active) return;
        setMembership(result.membership);
        if (result.membership) {
          setTier(result.membership.cardTier);
          setBlueCode(result.membership.broker?.code || "");
        }
        customerUpdatedRef.current(result.customer);
        setLoaded(true);
      })
      .catch((caught) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : "No se pudo abrir la membresía.");
        setLoaded(true);
      });
    return () => { active = false; };
  }, [customer.id, endpoint]);

  function managerPin(action: string) {
    if (staffRole === "MANAGER") return undefined;
    return window.prompt(`Ingresa el PIN del gerente para ${action}:`);
  }

  async function activate() {
    const pin = managerPin("activar Nekudot");
    if (staffRole !== "MANAGER" && pin === null) return;
    setBusy(true); setError("");
    try {
      const result = await post<DetailsResponse>(endpoint, {
        intent: "activateMembership",
        customerId: customer.id,
        cardTier: tier,
        blueAffiliationCode: blueCode,
        community: customer.profile?.community,
        phone: customer.phone,
        managerPin: pin,
      });
      setMembership(result.membership);
      onCustomerUpdated(result.customer);
      onMessage({ tone: "success", text: result.message || "Nekudot activado. El QR y el código de barras ya están listos." });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo activar Nekudot.");
    } finally { setBusy(false); }
  }

  async function addCredential() {
    if (!membership || credential.trim().length < 4) return;
    if (replace && !identityVerified) {
      setError("Confirma que verificaste la identidad antes de reemplazar tarjetas.");
      return;
    }
    const pin = managerPin(replace ? "reemplazar la tarjeta" : "agregar la tarjeta");
    if (staffRole !== "MANAGER" && pin === null) return;
    setBusy(true); setError("");
    try {
      const result = await post<{ message?: string }>(endpoint, {
        intent: "addCredential",
        customerId: customer.id,
        credential: credential.trim(),
        label,
        cardTier: membership.cardTier,
        blueAffiliationCode: membership.broker?.code || "",
        community: customer.profile?.community,
        phone: customer.phone,
        managerPin: pin,
        replace,
        identityVerified: identityVerified ? "yes" : "no",
      });
      await load();
      setCredential(""); setReplace(false); setIdentityVerified(false);
      onMessage({ tone: "success", text: result.message || "Tarjeta agregada al perfil." });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo agregar la tarjeta.");
    } finally { setBusy(false); }
  }

  async function removeCredential(item: Credential) {
    if (!window.confirm(`¿Eliminar la tarjeta terminación ${item.lastFour}? Permanecerá en el historial como revocada.`)) return;
    const pin = managerPin("eliminar la tarjeta");
    if (staffRole !== "MANAGER" && pin === null) return;
    setBusy(true); setError("");
    try {
      const result = await post<DetailsResponse>(endpoint, {
        intent: "removeCredential",
        customerId: customer.id,
        credentialId: item.id,
        managerPin: pin,
      });
      setMembership(result.membership);
      onCustomerUpdated(result.customer);
      onMessage({ tone: "success", text: result.message || "Tarjeta eliminada; el historial se conservó." });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo eliminar la tarjeta.");
    } finally { setBusy(false); }
  }

  if (!loaded) return <section className="pos-membership-manager"><div className="pos-membership-loading">Cargando QR, código de barras y tarjetas…</div></section>;

  return <section className="pos-membership-manager">
    <div className="pos-membership-manager__header"><div><span>NEKUDOT Y TARJETAS</span><h3>{membership ? `Tarjeta ${tierLabel(membership.cardTier)}` : "Activar cashback"}</h3></div>{membership ? <strong>{money(membership.availableCents)} disponibles</strong> : null}</div>
    {error ? <div className="pos-membership-error">{error}</div> : null}
    {!membership ? <div className="pos-membership-activation">
      <p>Este cliente ya existe en Shopify. La activación crea únicamente su wallet Nekudot y una tarjeta virtual; no duplica al cliente y no requiere foto.</p>
      <div className="pos-customer-form-grid">
        <label>Tipo de membresía<select value={tier} onChange={(event) => setTier(event.target.value as NekudotCardTier)}><option value="SILVER">Plata · 2%</option><option value="BLUE">Blue · 5%</option><option value="GOLDEN">Golden · 8%</option><option value="VOUCHER">Vales</option></select></label>
        {tier === "BLUE" ? <label>Palabra o clave Blue<input value={blueCode} onChange={(event) => setBlueCode(event.target.value)} placeholder="Palabra clave o código del IB" /></label> : null}
      </div>
      <button type="button" disabled={busy || (tier === "BLUE" && !blueCode.trim())} onClick={() => void activate()}>{busy ? "Activando…" : "Activar tarjeta virtual y cashback"}</button>
    </div> : <>
      <div className="pos-membership-card">
        <div className="pos-membership-identity">{membership.photoUrl ? <img src={membership.photoUrl} alt={`Foto de ${membership.displayName}`} /> : <div aria-label="Sin foto">{membership.displayName.slice(0, 2).toUpperCase()}</div>}<span><strong>{membership.displayName}</strong><small>{membership.cashbackBasisPoints / 100}% cashback{membership.broker ? ` · IB ${membership.broker.displayName}` : ""}</small></span></div>
        <div className="pos-membership-codes"><figure><img src={membership.qrDataUrl} alt="QR digital Nekudot" /><figcaption>QR digital</figcaption></figure><figure className="barcode"><img src={membership.barcodeDataUrl} alt="Código de barras Nekudot" /><figcaption>{membership.cardNumber}</figcaption></figure></div>
      </div>

      <h4>Tarjetas registradas</h4>
      <div className="pos-credential-list">{membership.credentials.map((item) => <article className={item.active ? "active" : "revoked"} key={item.id}><div><strong>{item.label || credentialLabel(item.kind)}</strong><span>{credentialLabel(item.kind)} · termina {item.lastFour}</span><small>{item.active ? `Activa desde ${new Date(item.createdAt).toLocaleDateString("es-MX")}` : `Eliminada ${item.revokedAt ? new Date(item.revokedAt).toLocaleDateString("es-MX") : ""}`}</small></div><b>{item.active ? "ACTIVA" : "HISTORIAL"}</b>{item.active && item.removable ? <button type="button" disabled={busy} onClick={() => void removeCredential(item)}>Eliminar</button> : null}</article>)}</div>

      <div className="pos-membership-add-card"><h4>Agregar tarjeta física</h4><label>ID de tarjeta<input value={credential} onChange={(event) => setCredential(event.target.value)} placeholder="Acerca la tarjeta o escribe el código" /></label><NfcBridgeReader compact onCredential={setCredential} /><label>Etiqueta<input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} /></label><label className="pos-membership-check"><input type="checkbox" checked={replace} onChange={(event) => { setReplace(event.target.checked); setIdentityVerified(false); }} /> Reemplazar las demás tarjetas físicas activas</label>{replace ? <label className="pos-membership-check warning"><input type="checkbox" checked={identityVerified} onChange={(event) => setIdentityVerified(event.target.checked)} /> Verifiqué la identidad del cliente</label> : null}<button type="button" disabled={busy || credential.trim().length < 4 || (replace && !identityVerified)} onClick={() => void addCredential()}>{busy ? "Guardando…" : replace ? "Reemplazar tarjeta física" : "Agregar tarjeta"}</button><small>El QR y el código de barras digitales siempre se conservan. Las tarjetas eliminadas quedan visibles en el historial.</small></div>
    </>}
  </section>;
}
