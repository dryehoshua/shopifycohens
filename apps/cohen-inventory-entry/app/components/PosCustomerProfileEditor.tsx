import { useState } from "react";
import {
  NEKUDOT_COMMUNITIES,
  type NekudotCardTier,
} from "../nekudot-domain";
import "../pos-customer-profile.css";

export type PosCustomerAddress = {
  id: string;
  firstName: string;
  lastName: string;
  address1: string;
  address2: string;
  city: string;
  province: string;
  provinceCode: string;
  zip: string;
  countryCode: string;
  phone: string | null;
};

export type PosCustomerProfile = {
  community: string | null;
  cardTier: NekudotCardTier | null;
  blueAffiliationCode: string | null;
  deliveryInstructions: string | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
};

export type PosCustomerRecord = {
  id: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  email: string | null;
  phone?: string | null;
  address?: PosCustomerAddress | null;
  profile?: PosCustomerProfile | null;
};

export type PosCustomerProfileDraft = {
  customerId: string | null;
  addressId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address1: string;
  address2: string;
  city: string;
  province: string;
  zip: string;
  countryCode: string;
  addressPhone: string;
  community: string;
  cardTier: NekudotCardTier | "";
  blueAffiliationCode: string;
  deliveryInstructions: string;
};

function initialDraft(customer: PosCustomerRecord | null): PosCustomerProfileDraft {
  return {
    customerId: customer?.id || null,
    addressId: customer?.address?.id || null,
    firstName: customer?.firstName || customer?.displayName?.split(/\s+/)[0] || "",
    lastName: customer?.lastName || customer?.displayName?.split(/\s+/).slice(1).join(" ") || "",
    email: customer?.email || "",
    phone: customer?.phone || "",
    address1: customer?.address?.address1 || "",
    address2: customer?.address?.address2 || "",
    city: customer?.address?.city || "",
    province: customer?.address?.province || "",
    zip: customer?.address?.zip || "",
    countryCode: customer?.address?.countryCode || "MX",
    addressPhone: customer?.address?.phone || customer?.phone || "",
    community: customer?.profile?.community || "",
    cardTier: customer?.profile?.cardTier || "",
    blueAffiliationCode: customer?.profile?.blueAffiliationCode || "",
    deliveryInstructions: customer?.profile?.deliveryInstructions || "",
  };
}

export function PosCustomerProfileEditor({
  customer,
  busy,
  onCancel,
  onSave,
}: {
  customer: PosCustomerRecord | null;
  busy: boolean;
  onCancel(): void;
  onSave(draft: PosCustomerProfileDraft): void | Promise<void>;
}) {
  const [draft, setDraft] = useState(() => initialDraft(customer));
  const update = <Key extends keyof PosCustomerProfileDraft>(key: Key, value: PosCustomerProfileDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  return <section className="pos-customer-editor">
    <div className="pos-customer-editor__header">
      <div><span>{customer ? "EDITAR CLIENTE" : "NUEVO CLIENTE"}</span><h3>{customer?.displayName || "Registrar persona"}</h3></div>
      <button type="button" onClick={onCancel}>Cancelar</button>
    </div>

    <h4>Datos personales</h4>
    <div className="pos-customer-form-grid">
      <label>Nombre<input value={draft.firstName} onChange={(event) => update("firstName", event.target.value)} required maxLength={60} /></label>
      <label>Apellidos<input value={draft.lastName} onChange={(event) => update("lastName", event.target.value)} maxLength={80} /></label>
      <label>Teléfono<input value={draft.phone} onChange={(event) => update("phone", event.target.value)} inputMode="tel" placeholder="55 1234 5678" /></label>
      <label>Correo<input value={draft.email} onChange={(event) => update("email", event.target.value)} inputMode="email" type="email" placeholder="cliente@ejemplo.com" /></label>
      <label>Comunidad<select value={draft.community} onChange={(event) => update("community", event.target.value)}><option value="">Sin especificar</option>{NEKUDOT_COMMUNITIES.map((community) => <option value={community} key={community}>{community}</option>)}</select></label>
      <label>Tipo de tarjeta<select value={draft.cardTier} onChange={(event) => update("cardTier", event.target.value as NekudotCardTier | "")}><option value="">Sin membresía todavía</option><option value="SILVER">Silver · 2%</option><option value="BLUE">Blue · 5%</option><option value="GOLDEN">Golden · 8%</option><option value="VOUCHER">Vales · sin cashback</option></select></label>
      {draft.cardTier === "BLUE" ? <label className="pos-customer-form-grid__wide">Clave de afiliación Blue<input value={draft.blueAffiliationCode} onChange={(event) => update("blueAffiliationCode", event.target.value)} placeholder="Código proporcionado por el IB" maxLength={40} /></label> : null}
    </div>

    <h4>Domicilio para entregas <small>(opcional)</small></h4>
    <div className="pos-customer-form-grid">
      <label className="pos-customer-form-grid__wide">Calle y número<input value={draft.address1} onChange={(event) => update("address1", event.target.value)} placeholder="Calle, número exterior" maxLength={180} /></label>
      <label className="pos-customer-form-grid__wide">Interior, colonia o referencia corta<input value={draft.address2} onChange={(event) => update("address2", event.target.value)} maxLength={180} /></label>
      <label>Ciudad o alcaldía<input value={draft.city} onChange={(event) => update("city", event.target.value)} maxLength={100} /></label>
      <label>Estado<input value={draft.province} onChange={(event) => update("province", event.target.value)} maxLength={100} /></label>
      <label>Código postal<input value={draft.zip} onChange={(event) => update("zip", event.target.value)} inputMode="numeric" maxLength={20} /></label>
      <label>País (código)<input value={draft.countryCode} onChange={(event) => update("countryCode", event.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2))} placeholder="MX" maxLength={2} /></label>
      <label className="pos-customer-form-grid__wide">Teléfono para la entrega<input value={draft.addressPhone} onChange={(event) => update("addressPhone", event.target.value)} inputMode="tel" /></label>
      <label className="pos-customer-form-grid__wide">Indicaciones de entrega<textarea value={draft.deliveryInstructions} onChange={(event) => update("deliveryInstructions", event.target.value)} placeholder="Acceso, recepción, horario o instrucciones para el repartidor" maxLength={500} rows={3} /></label>
    </div>

    <div className="pos-customer-editor__notice">La dirección se guarda en la tienda Shopify de esta POS. Nekudot conserva la membresía compartida entre tiendas.</div>
    <button className="pos-customer-editor__save" type="button" disabled={busy || draft.firstName.trim().length < 2} onClick={() => void onSave(draft)}>{busy ? "Guardando…" : customer ? "Guardar cambios" : "Crear cliente"}</button>
  </section>;
}
