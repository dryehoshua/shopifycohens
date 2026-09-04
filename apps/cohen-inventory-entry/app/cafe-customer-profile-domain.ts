import {
  NEKUDOT_CARD_TIERS,
  NEKUDOT_COMMUNITIES,
  normalizeBrokerCode,
  type NekudotCardTier,
} from "./nekudot-domain.ts";

export type CafeCustomerProfileInput = {
  customerId: string | null;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  address: {
    id: string | null;
    address1: string;
    address2: string | null;
    city: string | null;
    province: string | null;
    zip: string | null;
    countryCode: string;
    phone: string | null;
  } | null;
  community: string | null;
  cardTier: NekudotCardTier | null;
  blueAffiliationCode: string | null;
  deliveryInstructions: string | null;
};

function text(value: unknown, maximum: number) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maximum);
}

function multiline(value: unknown, maximum: number) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\r\n?/g, "\n")
    .slice(0, maximum);
}

export function normalizeCafeCustomerPhone(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  const normalized = digits.length === 10
    ? `+52${digits}`
    : digits.startsWith("52") && digits.length === 12
      ? `+${digits}`
      : raw.startsWith("+")
        ? `+${digits}`
        : `+${digits}`;
  if (!/^\+[1-9]\d{9,14}$/.test(normalized)) {
    throw new Error("Escribe el teléfono con 10 dígitos o con clave internacional.");
  }
  return normalized;
}

function customerId(value: unknown) {
  const id = text(value, 100);
  if (!id) return null;
  if (!/^gid:\/\/shopify\/Customer\/\d+$/.test(id)) {
    throw new Error("El cliente de Shopify no es válido.");
  }
  return id;
}

function addressId(value: unknown) {
  const id = text(value, 180);
  if (!id) return null;
  if (!/^gid:\/\/shopify\/MailingAddress\/\d+/.test(id)) {
    throw new Error("La dirección de Shopify no es válida.");
  }
  return id;
}

export function normalizeCafeCustomerProfile(input: Record<string, unknown>): CafeCustomerProfileInput {
  const firstName = text(input.firstName, 60);
  const lastName = text(input.lastName, 80);
  if (firstName.length < 2) throw new Error("Escribe el nombre del cliente.");

  const email = text(input.email, 180).toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Escribe un correo electrónico válido.");
  }
  const phone = normalizeCafeCustomerPhone(input.phone);
  if (!phone) throw new Error("El teléfono del cliente es obligatorio.");

  const address1 = text(input.address1, 180);
  const address2 = text(input.address2, 180) || null;
  const city = text(input.city, 100) || null;
  const province = text(input.province, 100) || null;
  const zip = text(input.zip, 20) || null;
  const addressPhone = normalizeCafeCustomerPhone(input.addressPhone || input.phone);
  const hasAddressDetails = Boolean(address1 || address2 || city || province || zip);
  if (hasAddressDetails && !address1) {
    throw new Error("Escribe la calle y número para guardar la dirección.");
  }
  const countryCode = text(input.countryCode, 2).toUpperCase() || "MX";
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error("El código de país no es válido.");

  const community = text(input.community, 100) || null;
  if (community && !NEKUDOT_COMMUNITIES.includes(community as (typeof NEKUDOT_COMMUNITIES)[number])) {
    throw new Error("Selecciona una comunidad válida.");
  }
  const requestedTier = text(input.cardTier, 20).toUpperCase();
  const cardTier = requestedTier
    ? NEKUDOT_CARD_TIERS.includes(requestedTier as NekudotCardTier)
      ? requestedTier as NekudotCardTier
      : null
    : null;
  if (requestedTier && !cardTier) throw new Error("Selecciona un tipo de tarjeta válido.");
  const requestedBlueCode = text(input.blueAffiliationCode, 40);
  const blueAffiliationCode = cardTier === "BLUE" && requestedBlueCode
    ? normalizeBrokerCode(requestedBlueCode)
    : null;

  return {
    customerId: customerId(input.customerId),
    firstName,
    lastName,
    email,
    phone,
    address: hasAddressDetails
      ? {
          id: addressId(input.addressId),
          address1,
          address2,
          city,
          province,
          zip,
          countryCode,
          phone: addressPhone,
        }
      : null,
    community,
    cardTier,
    blueAffiliationCode,
    deliveryInstructions: multiline(input.deliveryInstructions, 500) || null,
  };
}
