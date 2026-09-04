import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import bwipjs from "bwip-js";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import db from "./db.server";
import { NEKUDOT_PROGRAM_KEY, normalizeBrokerCode, normalizeNekudotCommunity, type NekudotCardTier } from "./nekudot-domain";
import { claimPendingNekudotOrders } from "./nekudot.server";
import { unauthenticated } from "./shopify.server";

export type RegistrationKind = "plata" | "blue" | "golden" | "vales";

export const REGISTRATION_OPTIONS: Record<RegistrationKind, {
  title: string;
  tier: NekudotCardTier;
  tag: string;
  status: "ACTIVE" | "PENDING_PAYMENT";
}> = {
  plata: { title: "Nekudot Plata", tier: "SILVER", tag: "NEKUDOT_PLATA", status: "ACTIVE" },
  blue: { title: "Nekudot Blue", tier: "BLUE", tag: "NEKUDOT_BLUE", status: "ACTIVE" },
  golden: { title: "Nekudot Golden", tier: "GOLDEN", tag: "NEKUDOT_GOLDEN_PENDIENTE", status: "PENDING_PAYMENT" },
  vales: { title: "Tarjeta de Vales", tier: "VOUCHER", tag: "NEKUDOT_VALES", status: "ACTIVE" },
};

const TYPE_TAGS = ["NEKUDOT_PLATA", "NEKUDOT_BLUE", "NEKUDOT_GOLDEN", "NEKUDOT_GOLDEN_PENDIENTE", "NEKUDOT_GOLDEN_INACTIVA", "NEKUDOT_VALES"];
const PORTAL_COOKIE = "cohens_nekudot_session";
const BROKER_PORTAL_COOKIE = "cohens_nekudot_ib_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const GOLDEN_MONTHLY_PRICE_CENTS = 30_000;

export class RegistrationError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

type ShopifyCustomer = {
  id: string;
  legacyResourceId: string;
  displayName: string;
  defaultEmailAddress: { emailAddress: string } | null;
  defaultPhoneNumber: { phoneNumber: string } | null;
};

async function graphql<T>(admin: AdminApiContext, query: string, variables: Record<string, unknown> = {}) {
  const response = await admin.graphql(query, { variables });
  const payload = await response.json() as { data?: T; errors?: Array<{ message?: string }> };
  if (payload.errors?.length) throw new RegistrationError(payload.errors.map((error) => error.message || "Error Shopify").join("; "), 502);
  if (!payload.data) throw new RegistrationError("Shopify no devolvió datos.", 502);
  return payload.data;
}

export function registrationKind(value: unknown): RegistrationKind {
  const kind = String(value || "").toLowerCase();
  if (!(kind in REGISTRATION_OPTIONS)) throw new RegistrationError("El enlace de registro no es válido.", 404);
  return kind as RegistrationKind;
}

export function normalizeInternationalPhone(
  value: unknown,
  countryCodeValue: unknown = "+52",
  customCountryCodeValue: unknown = "",
) {
  const raw = String(value || "").normalize("NFKC").trim();
  const digits = raw.replace(/\D/g, "");
  const selectedCode = String(countryCodeValue || "+52").trim();
  const countryCode = selectedCode === "other"
    ? String(customCountryCodeValue || "").trim()
    : selectedCode;
  if (!/^\+[1-9]\d{0,3}$/.test(countryCode)) {
    throw new RegistrationError("Selecciona una lada internacional válida.");
  }
  const prefixDigits = countryCode.slice(1);
  const alreadyInternational = raw.startsWith("+")
    || (digits.length > 10 && digits.startsWith(prefixDigits));
  const normalized = alreadyInternational ? `+${digits}` : `${countryCode}${digits}`;
  if (!/^\+[1-9]\d{9,14}$/.test(normalized)) {
    throw new RegistrationError("Escribe un teléfono válido, incluyendo su país.");
  }
  return normalized;
}

function phoneFromFormData(formData: FormData) {
  return normalizeInternationalPhone(
    formData.get("phone"),
    formData.get("countryCode"),
    formData.get("customCountryCode"),
  );
}

function cleanText(value: unknown, label: string, max = 100) {
  const result = String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, max);
  if (result.length < 2) throw new RegistrationError(`Escribe ${label}.`);
  return result;
}

function registrationCommunity(value: unknown) {
  try {
    return normalizeNekudotCommunity(value);
  } catch {
    throw new RegistrationError("Selecciona una de las siete comunidades disponibles.");
  }
}

function registrationShop() {
  const shop = (process.env.NEKUDOT_REGISTRATION_SHOP || process.env.RETAIL_SHOP_DOMAIN || process.env.COHENS_SOURCE_SHOP || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    throw new RegistrationError("Falta configurar NEKUDOT_REGISTRATION_SHOP.", 503);
  }
  return shop;
}

function hmacSecret() {
  const secret = process.env.NEKUDOT_TOKEN_SECRET?.trim() || process.env.SHOPIFY_API_SECRET?.trim();
  if (!secret) throw new RegistrationError("Falta configurar NEKUDOT_TOKEN_SECRET.", 503);
  return secret;
}

function secureEquals(left: string, right: string) {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

function maskedName(value: string) {
  return value.split(/\s+/).filter(Boolean).map((part) => `${part.slice(0, 1)}${"•".repeat(Math.min(3, Math.max(1, part.length - 1)))}`).join(" ");
}

function maskedEmail(value: string | null) {
  if (!value) return null;
  const [local, domain] = value.split("@", 2);
  if (!local || !domain) return null;
  return `${local.slice(0, 1)}•••@${domain}`;
}

function existingMemberToken(memberId: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + 30 * 60;
  const payload = `${memberId}.${expiresAt}`;
  const signature = createHmac("sha256", hmacSecret()).update(`existing-member:${payload}`).digest("base64url").slice(0, 24);
  return Buffer.from(`${payload}.${signature}`).toString("base64url");
}

async function memberFromExistingToken(value: unknown) {
  let decoded = "";
  try {
    decoded = Buffer.from(String(value || ""), "base64url").toString("utf8");
  } catch {
    throw new RegistrationError("La selección expiró. Vuelve a revisar tus datos.", 409);
  }
  const match = /^([A-Za-z0-9_-]{8,64})\.(\d{10})\.([A-Za-z0-9_-]{24})$/.exec(decoded);
  if (!match || Number(match[2]) < Math.floor(Date.now() / 1000)) {
    throw new RegistrationError("La selección expiró. Vuelve a revisar tus datos.", 409);
  }
  const payload = `${match[1]}.${match[2]}`;
  const expected = createHmac("sha256", hmacSecret()).update(`existing-member:${payload}`).digest("base64url").slice(0, 24);
  if (!secureEquals(match[3], expected)) throw new RegistrationError("La selección no es válida.", 409);
  const member = await db.nekudotMember.findFirst({
    where: { id: match[1], programKey: NEKUDOT_PROGRAM_KEY, active: true, phone: { not: null } },
  });
  if (!member?.phone) throw new RegistrationError("Esta cuenta necesita ayuda para recuperar el acceso.", 409);
  return member;
}

function qrCredential(memberId: string) {
  return `NKD1-${createHmac("sha256", hmacSecret()).update(`qr:${memberId}`).digest("base64url").slice(0, 32)}`;
}

function registrationClaim() {
  const memberId = randomUUID();
  const signature = createHmac("sha256", hmacSecret())
    .update(`registration:${memberId}`)
    .digest("base64url")
    .slice(0, 20);
  return `${memberId}.${signature}`;
}

function registrationIdFromClaim(value: unknown) {
  const claim = String(value || "").trim();
  const match = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{20})$/i.exec(claim);
  if (!match) throw new RegistrationError("La tarjeta preliminar expiró. Actualiza la página e inténtalo de nuevo.", 409);
  const expected = createHmac("sha256", hmacSecret())
    .update(`registration:${match[1]}`)
    .digest("base64url")
    .slice(0, 20);
  if (!secureEquals(match[2], expected)) throw new RegistrationError("La tarjeta preliminar no es válida. Actualiza la página.", 409);
  return match[1];
}

function publicCardNumber(memberId: string) {
  const seed = BigInt(`0x${createHash("sha256").update(`nekudot-barcode:${memberId}`).digest("hex").slice(0, 16)}`);
  const body = `2${(seed % 100_000_000_000n).toString().padStart(11, "0")}`;
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

function registrationCookieName(kind: RegistrationKind) {
  return `cohens_nekudot_registration_${kind}`;
}

function registrationCookie(request: Request, kind: RegistrationKind, value: string, maxAge = 30 * 60) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${registrationCookieName(kind)}=${encodeURIComponent(value)}; Path=/registro/${kind}; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function registrationClaimFromRequest(request: Request, kind: RegistrationKind) {
  const name = `${registrationCookieName(kind)}=`;
  const encoded = (request.headers.get("Cookie") || "")
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(name))
    ?.slice(name.length);
  if (!encoded) return null;
  try {
    const claim = decodeURIComponent(encoded);
    registrationIdFromClaim(claim);
    return claim;
  } catch {
    return null;
  }
}

export async function registrationCardPreview(request: Request, kindValue: unknown) {
  const kind = registrationKind(kindValue);
  const claim = registrationClaimFromRequest(request, kind) || registrationClaim();
  const memberId = claim.slice(0, 36);
  const rawQr = qrCredential(memberId);
  return {
    preview: {
      claim,
      qrDataUrl: await QRCode.toDataURL(rawQr, { width: 360, margin: 2, errorCorrectionLevel: "M" }),
      barcodeDataUrl: await barcodeDataUrl(memberId),
      cardNumber: publicCardNumber(memberId),
    },
    setCookie: registrationCookie(request, kind, claim),
  };
}

export function clearRegistrationCardPreview(request: Request, kindValue: unknown) {
  const kind = registrationKind(kindValue);
  return registrationCookie(request, kind, "", 0);
}

async function barcodeDataUrl(memberId: string) {
  const png = await bwipjs.toBuffer({
    bcid: "ean13",
    text: publicCardNumber(memberId),
    scale: 4,
    height: 20,
    includetext: false,
    backgroundcolor: "FFFFFF",
    paddingwidth: 18,
    paddingheight: 8,
  });
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function brokerForInviteCode(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) throw new RegistrationError("Escribe el código que te proporcionó tu IB.");
  const code = raw.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const broker = await db.nekudotBroker.findUnique({ where: { programKey_code: { programKey: NEKUDOT_PROGRAM_KEY, code } } });
  if (!broker?.active) throw new RegistrationError("El código de IB no es válido o ya no está activo.", 403);
  return broker;
}

function publicBrokerCode(value: unknown) {
  try {
    return normalizeBrokerCode(value);
  } catch {
    throw new RegistrationError("El código de referido debe tener entre 2 y 40 letras o números.");
  }
}

export async function registerPublicBroker(formData: FormData) {
  if (String(formData.get("website") || "")) throw new RegistrationError("No se pudo procesar el registro.");
  if (formData.get("privacy") !== "yes") throw new RegistrationError("Debes aceptar el aviso de privacidad.");

  const displayName = cleanText(formData.get("displayName"), "tu nombre completo", 100);
  const email = String(formData.get("email") || "").trim().toLowerCase().slice(0, 180);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RegistrationError("Escribe un correo electrónico válido.");
  const phone = phoneFromFormData(formData);
  const community = registrationCommunity(formData.get("community"));
  const code = publicBrokerCode(formData.get("code"));

  const conflict = await db.nekudotBroker.findFirst({
    where: {
      programKey: NEKUDOT_PROGRAM_KEY,
      OR: [{ code }, { email }, { phone }],
    },
  });
  if (conflict) {
    if (conflict.phone === phone || conflict.email?.toLowerCase() === email) {
      throw new RegistrationError("Ya existe un perfil IB con ese teléfono o correo. Entra al portal IB para continuar.", 409);
    }
    if (conflict.code === code) throw new RegistrationError("Ese código de referido ya está ocupado. Elige otro.", 409);
  }

  try {
    const broker = await db.nekudotBroker.create({
      data: {
        programKey: NEKUDOT_PROGRAM_KEY,
        displayName,
        email,
        phone,
        community,
        code,
        active: true,
      },
    });
    return {
      displayName: broker.displayName,
      code: broker.code,
      community: broker.community,
      referralPath: `/registro/blue?ib=${encodeURIComponent(broker.code)}`,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      throw new RegistrationError("Ese código de referido ya está ocupado. Elige otro.", 409);
    }
    throw error;
  }
}

function credentialHash(rawToken: string) {
  return createHmac("sha256", hmacSecret()).update(`${NEKUDOT_PROGRAM_KEY}:${rawToken}`).digest("hex");
}

async function ensureBarcodeCredential(memberId: string) {
  const rawBarcode = publicCardNumber(memberId);
  const tokenHash = credentialHash(rawBarcode);
  const existing = await db.nekudotCredential.findUnique({
    where: { programKey_tokenHash: { programKey: NEKUDOT_PROGRAM_KEY, tokenHash } },
  });
  if (existing && existing.memberId !== memberId) {
    throw new RegistrationError("No se pudo asignar un número de tarjeta único. Inténtalo de nuevo.", 409);
  }
  if (existing) {
    await db.nekudotCredential.update({
      where: { id: existing.id },
      data: { active: true, revokedAt: null, revokedReason: null, kind: "BARCODE", label: "Código de barras EAN-13" },
    });
  } else {
    await db.nekudotCredential.create({
      data: {
        programKey: NEKUDOT_PROGRAM_KEY,
        memberId,
        tokenHash,
        lastFour: rawBarcode.slice(-4),
        kind: "BARCODE",
        label: "Código de barras EAN-13",
      },
    });
  }
  return rawBarcode;
}

function photoDirectory() {
  return process.env.NEKUDOT_UPLOAD_DIR?.trim() || path.join(process.cwd(), "data", "nekudot-photos");
}

async function savePhoto(memberId: string, value: FormDataEntryValue | null) {
  if (!(value instanceof File) || value.size === 0) return null;
  if (value.size > 4 * 1024 * 1024) throw new RegistrationError("La foto debe pesar menos de 4 MB.");
  const bytes = Buffer.from(await value.arrayBuffer());
  let extension: "jpg" | "png" | "webp" | null = null;
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) extension = "jpg";
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) extension = "png";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") extension = "webp";
  if (!extension) throw new RegistrationError("La foto debe ser JPG, PNG o WebP.");
  const fileName = `${memberId}-${randomBytes(8).toString("hex")}.${extension}`;
  await mkdir(photoDirectory(), { recursive: true });
  await writeFile(path.join(photoDirectory(), fileName), bytes, { flag: "wx" });
  return fileName;
}

async function findCustomer(admin: AdminApiContext, email: string, phone: string) {
  const search = email ? `email:${JSON.stringify(email)}` : `phone:${JSON.stringify(phone)}`;
  const data = await graphql<{ customers: { nodes: ShopifyCustomer[] } }>(admin, `#graphql
    query NekudotRegistrationCustomer($query: String!) {
      customers(first: 5, query: $query) {
        nodes { id legacyResourceId displayName defaultEmailAddress { emailAddress } defaultPhoneNumber { phoneNumber } }
      }
    }
  `, { query: search });
  return data.customers.nodes.find((customer) =>
    customer.defaultEmailAddress?.emailAddress?.toLowerCase() === email.toLowerCase()
    || customer.defaultPhoneNumber?.phoneNumber === phone,
  ) || null;
}

async function customerById(admin: AdminApiContext, customerId: string) {
  if (!/^gid:\/\/shopify\/Customer\/\d+$/.test(customerId)) throw new RegistrationError("El cliente seleccionado no es válido.", 400);
  const data = await graphql<{ customer: ShopifyCustomer | null }>(admin, `#graphql
    query NekudotRegistrationCustomerById($id: ID!) {
      customer(id: $id) {
        id legacyResourceId displayName
        defaultEmailAddress { emailAddress }
        defaultPhoneNumber { phoneNumber }
      }
    }
  `, { id: customerId });
  if (!data.customer) throw new RegistrationError("La cuenta seleccionada ya no está disponible.", 404);
  return data.customer;
}

async function registrationCandidates(admin: AdminApiContext, email: string, phone: string, displayName: string) {
  const queries = [`email:${JSON.stringify(email)}`, `phone:${JSON.stringify(phone)}`, `name:${JSON.stringify(displayName)}`];
  const customers = new Map<string, ShopifyCustomer>();
  for (const query of queries) {
    const data = await graphql<{ customers: { nodes: ShopifyCustomer[] } }>(admin, `#graphql
      query NekudotRegistrationCandidates($query: String!) {
        customers(first: 10, query: $query) {
          nodes { id legacyResourceId displayName defaultEmailAddress { emailAddress } defaultPhoneNumber { phoneNumber } }
        }
      }
    `, { query });
    for (const customer of data.customers.nodes) customers.set(customer.id, customer);
  }
  const normalizedName = displayName.normalize("NFKC").trim().toLocaleLowerCase("es-MX");
  return [...customers.values()].filter((customer) => {
    const candidateEmail = customer.defaultEmailAddress?.emailAddress?.trim().toLowerCase();
    const candidatePhone = customer.defaultPhoneNumber?.phoneNumber?.replace(/\D/g, "");
    const candidateName = customer.displayName.normalize("NFKC").trim().toLocaleLowerCase("es-MX");
    return candidateEmail === email || candidatePhone === phone.replace(/\D/g, "") || candidateName === normalizedName;
  }).slice(0, 5);
}

function maskedPhone(value: string | null | undefined) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : "teléfono no disponible";
}

function maskedContactEmail(value: string | null | undefined) {
  const [name, domain] = String(value || "").split("@");
  if (!name || !domain) return "correo no disponible";
  return `${name.slice(0, 2)}•••@${domain}`;
}

async function createRegistrationMatches(input: {
  shop: string;
  kind: RegistrationKind;
  candidates: ShopifyCustomer[];
  requestedData: Record<string, string>;
}) {
  await db.nekudotRegistrationRecovery.updateMany({
    where: { shop: input.shop, status: { in: ["PENDING", "OTP_SENT"] }, expiresAt: { lt: new Date() } },
    data: { status: "EXPIRED" },
  });
  return Promise.all(input.candidates.map(async (customer) => {
    const phone = customer.defaultPhoneNumber?.phoneNumber || null;
    const email = customer.defaultEmailAddress?.emailAddress || null;
    const recovery = await db.nekudotRegistrationRecovery.create({ data: {
      programKey: NEKUDOT_PROGRAM_KEY,
      shop: input.shop,
      shopifyCustomerId: customer.id,
      requestedKind: input.kind,
      requestedData: input.requestedData,
      destinationPhone: phone,
      maskedPhone: phone ? maskedPhone(phone) : null,
      maskedEmail: email ? maskedContactEmail(email) : null,
      expiresAt: new Date(Date.now() + 15 * 60_000),
    } });
    return {
      token: `shopify:${recovery.id}`,
      name: maskedName(customer.displayName),
      phone: phone ? maskedPhone(phone) : "Sin teléfono verificable",
      email: maskedContactEmail(email),
      cardTier: "CLIENTE_SHOPIFY",
    };
  }));
}

async function createCustomer(admin: AdminApiContext, input: { firstName: string; lastName: string; email: string; phone: string; tag: string }) {
  const data = await graphql<{
    customerCreate: { customer: ShopifyCustomer | null; userErrors: Array<{ message: string }> };
  }>(admin, `#graphql
    mutation NekudotRegistrationCreate($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { id legacyResourceId displayName defaultEmailAddress { emailAddress } defaultPhoneNumber { phoneNumber } }
        userErrors { message }
      }
    }
  `, { input: { firstName: input.firstName, lastName: input.lastName, email: input.email, phone: input.phone, tags: ["NEKUDOT", input.tag] } });
  if (data.customerCreate.userErrors.length || !data.customerCreate.customer) {
    throw new RegistrationError(data.customerCreate.userErrors.map((error) => error.message).join("; ") || "No se pudo crear el cliente en Shopify.", 409);
  }
  return data.customerCreate.customer;
}

async function setCustomerTags(admin: AdminApiContext, customerId: string, tag: string) {
  await graphql(admin, `#graphql
    mutation NekudotRegistrationRemoveTags($id: ID!, $tags: [String!]!) {
      tagsRemove(id: $id, tags: $tags) { userErrors { message } }
    }
  `, { id: customerId, tags: TYPE_TAGS.filter((item) => item !== tag) });
  const added = await graphql<{ tagsAdd: { userErrors: Array<{ message: string }> } }>(admin, `#graphql
    mutation NekudotRegistrationAddTags($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) { userErrors { message } }
    }
  `, { id: customerId, tags: ["NEKUDOT", tag] });
  if (added.tagsAdd.userErrors.length) throw new RegistrationError(added.tagsAdd.userErrors.map((error) => error.message).join("; "), 502);
}

export async function findRegistrationMatches(formData: FormData, kindValue: unknown) {
  const kind = registrationKind(kindValue);
  registrationIdFromClaim(formData.get("registrationClaim"));
  if (String(formData.get("website") || "")) throw new RegistrationError("No se pudo procesar el registro.");
  if (formData.get("privacy") !== "yes") throw new RegistrationError("Debes aceptar el aviso de privacidad.");

  const firstName = cleanText(formData.get("firstName"), "tu nombre", 60);
  const lastName = cleanText(formData.get("lastName"), "tus apellidos", 80);
  const community = registrationCommunity(formData.get("community"));
  const email = String(formData.get("email") || "").trim().toLowerCase().slice(0, 180);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RegistrationError("Escribe un correo electrónico válido.");
  const phone = phoneFromFormData(formData);
  const displayName = `${firstName} ${lastName}`;
  const ibCode = kind === "blue" ? String(formData.get("ibCode") || "").trim().slice(0, 40) : "";
  const shop = registrationShop();

  const members = await db.nekudotMember.findMany({
    where: {
      programKey: NEKUDOT_PROGRAM_KEY,
      active: true,
      phone: { not: null },
      OR: [{ phone }, { email }, { displayName }],
    },
    orderBy: { updatedAt: "desc" },
    take: 5,
  });
  const { admin } = await unauthenticated.admin(shop);
  const shopifyCandidates = await registrationCandidates(admin, email, phone, displayName);
  const linkedCustomerIds = new Set((await db.nekudotCustomerIdentity.findMany({
    where: { shop, shopifyCustomerId: { in: shopifyCandidates.map((customer) => customer.id) } },
    select: { shopifyCustomerId: true },
  })).map((identity) => identity.shopifyCustomerId));
  const requestedData = Object.fromEntries(
    [...formData.entries()].filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  const customerMatches = await createRegistrationMatches({
    shop,
    kind,
    candidates: shopifyCandidates.filter((customer) => Boolean(customer.defaultPhoneNumber?.phoneNumber) && !linkedCustomerIds.has(customer.id)),
    requestedData,
  });

  return {
    submitted: { firstName, lastName, community, email, phone, ibCode },
    matches: [...members.map((member) => ({
      token: existingMemberToken(member.id),
      name: maskedName(member.displayName),
      phone: `•••• ${member.phone!.slice(-4)}`,
      email: maskedEmail(member.email),
      cardTier: member.cardTier,
    })), ...customerMatches].slice(0, 8),
  };
}

export async function registerNekudot(formData: FormData, kindValue: unknown, verifiedCustomerId?: string) {
  const kind = registrationKind(kindValue);
  const option = REGISTRATION_OPTIONS[kind];
  const registrationId = registrationIdFromClaim(formData.get("registrationClaim"));
  if (kind === "golden") goldenPaymentConfiguration();
  if (String(formData.get("website") || "")) throw new RegistrationError("No se pudo procesar el registro.");
  const broker = kind === "blue" ? await brokerForInviteCode(formData.get("ibCode")) : null;
  const firstName = cleanText(formData.get("firstName"), "tu nombre", 60);
  const lastName = cleanText(formData.get("lastName"), "tus apellidos", 80);
  const community = registrationCommunity(formData.get("community"));
  const email = String(formData.get("email") || "").trim().toLowerCase().slice(0, 180);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RegistrationError("Escribe un correo electrónico válido.");
  const phone = phoneFromFormData(formData);
  if (formData.get("privacy") !== "yes") throw new RegistrationError("Debes aceptar el aviso de privacidad.");

  const shop = registrationShop();
  const { admin } = await unauthenticated.admin(shop);
  let customer = verifiedCustomerId
    ? await customerById(admin, verifiedCustomerId)
    : await findCustomer(admin, email, phone);
  if (customer) {
    const customerEmail = customer.defaultEmailAddress?.emailAddress?.trim().toLowerCase() || "";
    const customerPhone = customer.defaultPhoneNumber?.phoneNumber?.trim() || "";
    if (!verifiedCustomerId && (customerEmail !== email || customerPhone !== phone)) {
      throw new RegistrationError("Ya existe un cliente con parte de estos datos. Entra con el teléfono registrado o solicita ayuda para vincular la cuenta.", 409);
    }
    const linkedIdentity = await db.nekudotCustomerIdentity.findUnique({
      where: { shop_shopifyCustomerId: { shop, shopifyCustomerId: customer.id } },
    });
    if (linkedIdentity) {
      throw new RegistrationError("Esta cuenta Nekudot ya existe. Selecciona el registro correspondiente y confirma el código SMS para continuar.", 409);
    }
  }
  if (!customer) customer = await createCustomer(admin, { firstName, lastName, email, phone, tag: option.tag });
  else await setCustomerTags(admin, customer.id, option.tag);

  const displayName = `${firstName} ${lastName}`;
  const registration = await db.$transaction(async (transaction) => {
    const identity = await transaction.nekudotCustomerIdentity.findUnique({
      where: { shop_shopifyCustomerId: { shop, shopifyCustomerId: customer!.id } },
    });
    const existing = identity ? await transaction.nekudotMember.findUnique({ where: { id: identity.memberId } }) : null;
    if (existing) throw new RegistrationError("Esta cuenta Nekudot ya existe. Confirma su código SMS para continuar.", 409);
    const saved = await transaction.nekudotMember.create({
      data: { id: registrationId, programKey: NEKUDOT_PROGRAM_KEY, displayName, email, phone, community, cardTier: option.tier, enrollmentStatus: option.status, active: option.status === "ACTIVE", brokerId: broker?.id || null },
    });
    await transaction.nekudotCustomerIdentity.upsert({
      where: { shop_shopifyCustomerId: { shop, shopifyCustomerId: customer!.id } },
      create: {
        programKey: NEKUDOT_PROGRAM_KEY,
        memberId: saved.id,
        shop,
        shopifyCustomerId: customer!.id,
        shopifyLegacyCustomerId: String(customer!.legacyResourceId),
        displayName,
        email,
      },
      update: { memberId: saved.id, shopifyLegacyCustomerId: String(customer!.legacyResourceId), displayName, email },
    });
    const rawQr = qrCredential(saved.id);
    await transaction.nekudotCredential.upsert({
      where: { programKey_tokenHash: { programKey: NEKUDOT_PROGRAM_KEY, tokenHash: credentialHash(rawQr) } },
      create: { programKey: NEKUDOT_PROGRAM_KEY, memberId: saved.id, tokenHash: credentialHash(rawQr), lastFour: rawQr.slice(-4), kind: "QR", label: "QR digital" },
      update: { memberId: saved.id, active: true, revokedAt: null, revokedReason: null, label: "QR digital" },
    });
    if (broker && (broker.phone === phone || broker.email?.toLowerCase() === email)) {
      await transaction.nekudotBroker.update({
        where: { id: broker.id },
        data: { ownerMemberId: saved.id },
      });
    }
    return { member: saved, rawQr };
  });
  const { member, rawQr } = registration;
  const photoFileName = await savePhoto(member.id, formData.get("photo"));
  if (photoFileName) await db.nekudotMember.update({ where: { id: member.id }, data: { photoFileName } });
  await ensureBarcodeCredential(member.id);
  const checkoutUrl = kind === "golden" ? await createGoldenPayment(member.id, displayName, email) : null;
  return {
    memberId: member.id,
    displayName,
    community,
    status: option.status,
    cardTitle: option.title,
    ibName: broker?.displayName || null,
    checkoutUrl,
    qrDataUrl: await QRCode.toDataURL(rawQr, { width: 360, margin: 2, errorCorrectionLevel: "M" }),
    barcodeDataUrl: await barcodeDataUrl(member.id),
    credentialLastFour: rawQr.slice(-4),
    cardNumber: publicCardNumber(member.id),
  };
}

export async function sendRegistrationRecoveryOtp(recoveryIdValue: unknown) {
  const recoveryId = String(recoveryIdValue || "").trim();
  const recovery = await db.nekudotRegistrationRecovery.findUnique({ where: { id: recoveryId } });
  if (!recovery || !["PENDING", "OTP_SENT"].includes(recovery.status) || recovery.expiresAt.getTime() <= Date.now()) {
    throw new RegistrationError("La selección venció. Vuelve a buscar tu cuenta.", 410);
  }
  if (!recovery.destinationPhone) throw new RegistrationError("Esta cuenta no tiene un teléfono verificable. Solicita ayuda en tienda.", 409);
  if (!(process.env.NODE_ENV !== "production" && process.env.NEKUDOT_DEV_OTP)) {
    await twilioPost("Verifications", new URLSearchParams({ To: recovery.destinationPhone, Channel: "sms", Locale: "es" }));
  }
  await db.nekudotRegistrationRecovery.update({ where: { id: recovery.id }, data: { status: "OTP_SENT" } });
  return { recoveryId: recovery.id, contact: recovery.maskedPhone || "tu teléfono registrado" };
}

export async function verifyRegistrationRecovery(recoveryIdValue: unknown, codeValue: unknown) {
  const recoveryId = String(recoveryIdValue || "").trim();
  const recovery = await db.nekudotRegistrationRecovery.findUnique({ where: { id: recoveryId } });
  if (!recovery || recovery.status !== "OTP_SENT" || recovery.expiresAt.getTime() <= Date.now() || !recovery.destinationPhone) {
    throw new RegistrationError("La verificación venció. Inicia el registro nuevamente.", 410);
  }
  const code = String(codeValue || "").trim();
  let approved = process.env.NODE_ENV !== "production" && Boolean(process.env.NEKUDOT_DEV_OTP) && secureEquals(code, process.env.NEKUDOT_DEV_OTP || "");
  if (!approved) {
    const result = await twilioPost("VerificationCheck", new URLSearchParams({ To: recovery.destinationPhone, Code: code }));
    approved = result.status === "approved";
  }
  if (!approved) throw new RegistrationError("El código no es correcto o ya venció.", 401);
  const requestedData = recovery.requestedData as Record<string, unknown>;
  const formData = new FormData();
  for (const [key, value] of Object.entries(requestedData)) if (typeof value === "string") formData.set(key, value);
  const result = await registerNekudot(formData, recovery.requestedKind, recovery.shopifyCustomerId);
  await db.nekudotRegistrationRecovery.update({ where: { id: recovery.id }, data: { status: "VERIFIED", verifiedAt: new Date() } });
  const member = await db.nekudotMember.findUnique({ where: { id: result.memberId } });
  if (!member) throw new RegistrationError("No se pudo abrir la nueva cuenta Nekudot.", 500);
  await claimPendingNekudotOrders({ memberId: member.id, phone: member.phone, email: member.email });
  return createMemberPortalSession(member);
}

function goldenPaymentConfiguration() {
  const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim();
  const appUrl = process.env.SHOPIFY_APP_URL?.trim().replace(/\/$/, "");
  if (!accessToken || !webhookSecret || !appUrl) {
    throw new RegistrationError("El pago Golden todavía no está configurado.", 503);
  }
  return { accessToken, webhookSecret, appUrl, amountCents: GOLDEN_MONTHLY_PRICE_CENTS };
}

async function createGoldenPayment(memberId: string, displayName: string, email: string) {
  const config = goldenPaymentConfiguration();
  const externalReference = `nekudot-golden:${memberId}:${randomBytes(12).toString("hex")}`;
  const response = await fetch("https://api.mercadopago.com/preapproval", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      reason: `Membresía Nekudot Golden · ${displayName}`,
      external_reference: externalReference,
      payer_email: email,
      auto_recurring: {
        frequency: 1,
        frequency_type: "months",
        transaction_amount: config.amountCents / 100,
        currency_id: "MXN",
      },
      back_url: `${config.appUrl}/nekudot?subscription=return`,
      status: "pending",
    }),
  });
  const payload = await response.json() as { id?: string; init_point?: string; status?: string; message?: string };
  if (!response.ok || !payload.id || !payload.init_point) {
    throw new RegistrationError(payload.message || "Mercado Pago no pudo iniciar la suscripción Golden.", 502);
  }
  await db.nekudotMembershipPayment.create({
    data: {
      memberId,
      externalReference,
      subscriptionId: payload.id,
      status: String(payload.status || "PENDING").toUpperCase(),
      amountCents: config.amountCents,
      checkoutUrl: payload.init_point,
      rawPayload: payload,
    },
  });
  return payload.init_point;
}

function validateMercadoPagoSignature(request: Request, dataId: string) {
  const { webhookSecret } = goldenPaymentConfiguration();
  const signature = request.headers.get("x-signature") || "";
  const requestId = request.headers.get("x-request-id") || "";
  const fields = Object.fromEntries(signature.split(",").map((part) => part.trim().split("=", 2)));
  const timestamp = fields.ts || "";
  const received = fields.v1 || "";
  if (!timestamp || !requestId || !/^[a-f0-9]{64}$/i.test(received)) throw new RegistrationError("Firma de Mercado Pago ausente.", 401);
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${timestamp};`;
  const expected = createHmac("sha256", webhookSecret).update(manifest).digest("hex");
  if (!secureEquals(received.toLowerCase(), expected)) throw new RegistrationError("Firma de Mercado Pago no válida.", 401);
}

export async function processMercadoPagoWebhook(request: Request) {
  const body = await request.json().catch(() => ({})) as { type?: string; data?: { id?: string | number } };
  const eventType = String(body.type || "payment");
  if (eventType !== "payment" && eventType !== "subscription_preapproval") return { ignored: true };
  const url = new URL(request.url);
  const dataId = String(url.searchParams.get("data.id") || body.data?.id || "").trim();
  if (!dataId) throw new RegistrationError("La notificación no contiene un identificador.", 400);
  validateMercadoPagoSignature(request, dataId);
  const config = goldenPaymentConfiguration();

  if (eventType === "subscription_preapproval") {
    const response = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(dataId)}`, {
      headers: { Authorization: `Bearer ${config.accessToken}` },
    });
    const subscription = await response.json() as {
      id?: string; status?: string; external_reference?: string; message?: string;
      auto_recurring?: { transaction_amount?: number; currency_id?: string };
    };
    if (!response.ok) throw new RegistrationError(subscription.message || "No se pudo verificar la suscripción.", 502);
    const record = await db.nekudotMembershipPayment.findFirst({
      where: {
        OR: [
          { subscriptionId: String(subscription.id || dataId) },
          { externalReference: String(subscription.external_reference || "") },
        ],
      },
      include: { member: { include: { identities: true } } },
    });
    if (!record) throw new RegistrationError("La suscripción no corresponde a una membresía Nekudot.", 404);
    const amountCents = Math.round(Number(subscription.auto_recurring?.transaction_amount) * 100);
    if (amountCents !== record.amountCents || subscription.auto_recurring?.currency_id !== record.currencyCode) {
      throw new RegistrationError("El importe o la moneda de la suscripción no coincide.", 409);
    }

    const subscriptionStatus = String(subscription.status || "PENDING").toLowerCase();
    const active = subscriptionStatus === "authorized";
    const inactive = ["paused", "cancelled", "canceled"].includes(subscriptionStatus);
    if (!active && !inactive) {
      await db.nekudotMembershipPayment.update({
        where: { id: record.id },
        data: { subscriptionId: String(subscription.id || dataId), status: `SUBSCRIPTION_${subscriptionStatus.toUpperCase()}`, rawPayload: subscription },
      });
      return { approved: false, subscriptionStatus };
    }

    const identity = record.member.identities[0];
    if (!identity) throw new RegistrationError("La membresía no tiene cliente Shopify vinculado.", 409);
    const { admin } = await unauthenticated.admin(identity.shop);
    await setCustomerTags(admin, identity.shopifyCustomerId, active ? "NEKUDOT_GOLDEN" : "NEKUDOT_GOLDEN_INACTIVA");
    await db.$transaction([
      db.nekudotMembershipPayment.update({
        where: { id: record.id },
        data: { subscriptionId: String(subscription.id || dataId), status: `SUBSCRIPTION_${subscriptionStatus.toUpperCase()}`, rawPayload: subscription },
      }),
      db.nekudotMember.update({
        where: { id: record.memberId },
        data: {
          cardTier: "GOLDEN",
          enrollmentStatus: active ? "ACTIVE" : subscriptionStatus === "paused" ? "SUBSCRIPTION_PAUSED" : "SUBSCRIPTION_CANCELED",
          active,
        },
      }),
    ]);
    return { approved: active, subscriptionStatus };
  }

  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`, {
    headers: { Authorization: `Bearer ${config.accessToken}` },
  });
  const payment = await response.json() as {
    id?: number | string; status?: string; external_reference?: string; transaction_amount?: number;
    currency_id?: string; date_approved?: string; message?: string;
  };
  if (!response.ok) throw new RegistrationError(payment.message || "No se pudo verificar el pago.", 502);
  const record = await db.nekudotMembershipPayment.findUnique({
    where: { externalReference: String(payment.external_reference || "") },
    include: { member: { include: { identities: true } } },
  });
  if (!record) throw new RegistrationError("El pago no corresponde a una membresía Nekudot.", 404);
  const amountCents = Math.round(Number(payment.transaction_amount) * 100);
  if (amountCents !== record.amountCents || payment.currency_id !== record.currencyCode) {
    throw new RegistrationError("El importe o la moneda del pago no coincide.", 409);
  }
  if (payment.status !== "approved") {
    await db.nekudotMembershipPayment.update({ where: { id: record.id }, data: { status: String(payment.status || "PENDING").toUpperCase(), rawPayload: payment } });
    return { approved: false };
  }
  const identity = record.member.identities[0];
  if (!identity) throw new RegistrationError("La membresía no tiene cliente Shopify vinculado.", 409);
  const { admin } = await unauthenticated.admin(identity.shop);
  await setCustomerTags(admin, identity.shopifyCustomerId, "NEKUDOT_GOLDEN");
  await db.$transaction([
    db.nekudotMembershipPayment.update({
      where: { id: record.id },
      data: { status: "APPROVED", paymentId: String(payment.id), rawPayload: payment, paidAt: payment.date_approved ? new Date(payment.date_approved) : new Date() },
    }),
    db.nekudotMember.update({ where: { id: record.memberId }, data: { cardTier: "GOLDEN", enrollmentStatus: "ACTIVE", active: true } }),
  ]);
  return { approved: true };
}

function twilioConfiguration() {
  const apiKeySid = process.env.TWILIO_API_KEY_SID?.trim();
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET?.trim();
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID?.trim();
  const username = apiKeySid || accountSid;
  const password = apiKeySecret || authToken;
  if (!username || !password || !serviceSid) throw new RegistrationError("El acceso por SMS todavía no está configurado.", 503);
  return { username, password, serviceSid };
}

async function twilioPost(pathname: string, parameters: URLSearchParams) {
  const config = twilioConfiguration();
  const response = await fetch(`https://verify.twilio.com/v2/Services/${config.serviceSid}/${pathname}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: parameters,
  });
  const body = await response.json() as { status?: string; message?: string };
  if (!response.ok) throw new RegistrationError(body.message || "No se pudo enviar o validar el código SMS.", response.status >= 500 ? 502 : 400);
  return body;
}

async function shopifyCustomerForPhone(phone: string) {
  const shop = registrationShop();
  const { admin } = await unauthenticated.admin(shop);
  const customer = await findCustomer(admin, "", phone);
  return { shop, admin, customer };
}

async function createSilverMemberForExistingCustomer(phone: string) {
  const { shop, admin, customer } = await shopifyCustomerForPhone(phone);
  if (!customer) return null;
  const linked = await db.nekudotCustomerIdentity.findUnique({
    where: { shop_shopifyCustomerId: { shop, shopifyCustomerId: customer.id } },
    include: { member: true },
  });
  if (linked) return linked.member;

  await setCustomerTags(admin, customer.id, "NEKUDOT_PLATA");
  const displayName = customer.displayName?.trim() || "Cliente Cohen's";
  const email = customer.defaultEmailAddress?.emailAddress?.trim().toLowerCase() || null;
  const saved = await db.$transaction(async (transaction) => {
    const saved = await transaction.nekudotMember.create({
      data: {
        programKey: NEKUDOT_PROGRAM_KEY,
        displayName,
        email,
        phone,
        cardTier: "SILVER",
        enrollmentStatus: "ACTIVE",
        active: true,
      },
    });
    await transaction.nekudotCustomerIdentity.create({
      data: {
        programKey: NEKUDOT_PROGRAM_KEY,
        memberId: saved.id,
        shop,
        shopifyCustomerId: customer.id,
        shopifyLegacyCustomerId: String(customer.legacyResourceId),
        displayName,
        email,
      },
    });
    const rawQr = qrCredential(saved.id);
    await transaction.nekudotCredential.create({
      data: {
        programKey: NEKUDOT_PROGRAM_KEY,
        memberId: saved.id,
        tokenHash: credentialHash(rawQr),
        lastFour: rawQr.slice(-4),
        kind: "QR",
        label: "QR digital",
      },
    });
    return saved;
  });
  await ensureBarcodeCredential(saved.id);
  return saved;
}

async function sendPhoneOtp(phone: string) {
  if (process.env.NODE_ENV !== "production" && process.env.NEKUDOT_DEV_OTP) return { phone, sent: true };
  await twilioPost("Verifications", new URLSearchParams({ To: phone, Channel: "sms", Locale: "es" }));
  return { phone, sent: true };
}

async function verifyPhoneOtp(phone: string, codeValue: unknown) {
  const code = String(codeValue || "").trim();
  let approved = process.env.NODE_ENV !== "production" && Boolean(process.env.NEKUDOT_DEV_OTP) && secureEquals(code, process.env.NEKUDOT_DEV_OTP || "");
  if (!approved) {
    const result = await twilioPost("VerificationCheck", new URLSearchParams({ To: phone, Code: code }));
    approved = result.status === "approved";
  }
  if (!approved) throw new RegistrationError("El código no es correcto o ya venció.", 401);
}

async function createMemberPortalSession(member: { id: string }) {
  const token = randomBytes(32).toString("base64url");
  await db.nekudotPortalSession.create({
    data: { tokenHash: createHash("sha256").update(token).digest("hex"), memberId: member.id, expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000) },
  });
  return { member, cookie: `${PORTAL_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${process.env.NODE_ENV === "production" ? "; Secure" : ""}` };
}

export async function sendPortalOtp(phoneValue: unknown, countryCodeValue?: unknown, customCountryCodeValue?: unknown) {
  const phone = normalizeInternationalPhone(phoneValue, countryCodeValue, customCountryCodeValue);
  const member = await db.nekudotMember.findFirst({ where: { programKey: NEKUDOT_PROGRAM_KEY, phone } });
  if (!member) {
    const { customer } = await shopifyCustomerForPhone(phone);
    if (!customer) return { phone, sent: true };
  }
  return sendPhoneOtp(phone);
}

export async function verifyPortalOtp(phoneValue: unknown, codeValue: unknown) {
  const phone = normalizeInternationalPhone(phoneValue);
  await verifyPhoneOtp(phone, codeValue);
  let member = await db.nekudotMember.findFirst({ where: { programKey: NEKUDOT_PROGRAM_KEY, phone } });
  if (!member) member = await createSilverMemberForExistingCustomer(phone);
  if (!member) throw new RegistrationError("No encontramos una cuenta Nekudot con ese teléfono.", 404);
  await claimPendingNekudotOrders({ memberId: member.id, phone, email: member.email });
  return createMemberPortalSession(member);
}

export async function sendExistingRegistrationOtp(matchToken: unknown) {
  const token = String(matchToken || "");
  if (token.startsWith("shopify:")) {
    const challenge = await sendRegistrationRecoveryOtp(token.slice("shopify:".length));
    return { matchToken: token, phoneHint: challenge.contact };
  }
  const member = await memberFromExistingToken(matchToken);
  await sendPhoneOtp(member.phone!);
  return { matchToken: String(matchToken), phoneHint: `•••• ${member.phone!.slice(-4)}` };
}

export async function verifyExistingRegistrationOtp(matchToken: unknown, codeValue: unknown) {
  const token = String(matchToken || "");
  if (token.startsWith("shopify:")) {
    return verifyRegistrationRecovery(token.slice("shopify:".length), codeValue);
  }
  const member = await memberFromExistingToken(matchToken);
  await verifyPhoneOtp(member.phone!, codeValue);
  await claimPendingNekudotOrders({ memberId: member.id, phone: member.phone, email: member.email });
  return createMemberPortalSession(member);
}

export async function sendBrokerOtp(phoneValue: unknown, countryCodeValue?: unknown, customCountryCodeValue?: unknown) {
  const phone = normalizeInternationalPhone(phoneValue, countryCodeValue, customCountryCodeValue);
  const broker = await brokerForPhone(phone);
  if (!broker) return { phone, sent: true };
  if (process.env.NODE_ENV !== "production" && process.env.NEKUDOT_DEV_OTP) return { phone, sent: true };
  await twilioPost("Verifications", new URLSearchParams({ To: phone, Channel: "sms", Locale: "es" }));
  return { phone, sent: true };
}

export async function verifyBrokerOtp(phoneValue: unknown, codeValue: unknown) {
  const phone = normalizeInternationalPhone(phoneValue);
  const code = String(codeValue || "").trim();
  let approved = process.env.NODE_ENV !== "production" && Boolean(process.env.NEKUDOT_DEV_OTP) && secureEquals(code, process.env.NEKUDOT_DEV_OTP || "");
  if (!approved) {
    const result = await twilioPost("VerificationCheck", new URLSearchParams({ To: phone, Code: code }));
    approved = result.status === "approved";
  }
  if (!approved) throw new RegistrationError("El código no es correcto o ya venció.", 401);
  const broker = await brokerForPhone(phone);
  if (!broker) throw new RegistrationError("No encontramos un perfil IB activo con ese teléfono.", 404);
  const token = randomBytes(32).toString("base64url");
  await db.nekudotBrokerSession.create({
    data: { tokenHash: createHash("sha256").update(token).digest("hex"), brokerId: broker.id, expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000) },
  });
  return { broker, cookie: `${BROKER_PORTAL_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${process.env.NODE_ENV === "production" ? "; Secure" : ""}` };
}

async function brokerForPhone(phone: string) {
  const brokers = await db.nekudotBroker.findMany({ where: { programKey: NEKUDOT_PROGRAM_KEY, active: true, phone: { not: null } } });
  return brokers.find((broker) => {
    try {
      return normalizeInternationalPhone(broker.phone) === phone;
    } catch {
      return false;
    }
  }) || null;
}

function requestCookies(request: Request) {
  return Object.fromEntries((request.headers.get("cookie") || "").split(";").map((part) => part.trim().split(/=(.*)/s).slice(0, 2)).filter(([key]) => key));
}

export async function portalMember(request: Request) {
  const token = requestCookies(request)[PORTAL_COOKIE];
  if (!token) return null;
  const session = await db.nekudotPortalSession.findUnique({
    where: { tokenHash: createHash("sha256").update(token).digest("hex") },
    include: { member: { include: { identities: true } } },
  });
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now()) return null;
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) await db.nekudotPortalSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  return session.member;
}

export async function logoutPortal(request: Request) {
  const token = requestCookies(request)[PORTAL_COOKIE];
  if (token) await db.nekudotPortalSession.updateMany({ where: { tokenHash: createHash("sha256").update(token).digest("hex") }, data: { revokedAt: new Date() } });
  return `${PORTAL_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export async function portalBroker(request: Request) {
  const token = requestCookies(request)[BROKER_PORTAL_COOKIE];
  if (!token) return null;
  const session = await db.nekudotBrokerSession.findUnique({
    where: { tokenHash: createHash("sha256").update(token).digest("hex") },
    include: { broker: true },
  });
  if (!session || session.revokedAt || session.expiresAt.getTime() <= Date.now() || !session.broker.active) return null;
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
    await db.nekudotBrokerSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return session.broker;
}

export async function logoutBrokerPortal(request: Request) {
  const token = requestCookies(request)[BROKER_PORTAL_COOKIE];
  if (token) {
    await db.nekudotBrokerSession.updateMany({
      where: { tokenHash: createHash("sha256").update(token).digest("hex") },
      data: { revokedAt: new Date() },
    });
  }
  return `${BROKER_PORTAL_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
}

export async function brokerDashboard(brokerId: string) {
  const broker = await db.nekudotBroker.findUnique({
    where: { id: brokerId },
    include: {
      clients: {
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          displayName: true,
          community: true,
          cardTier: true,
          active: true,
          lifetimeEarnedCents: true,
          createdAt: true,
        },
      },
      ownerMember: {
        select: {
          id: true,
          displayName: true,
          balanceCents: true,
          reservedCents: true,
          lifetimeEarnedCents: true,
          cardTier: true,
        },
      },
      ledger: {
        orderBy: { occurredAt: "desc" },
        take: 20,
        select: { id: true, type: true, amountCents: true, description: true, occurredAt: true },
      },
    },
  });
  if (!broker?.active) throw new RegistrationError("El perfil IB no está activo.", 403);
  return broker;
}

export async function memberCardData(memberId: string) {
  const member = await db.nekudotMember.findUnique({
    where: { id: memberId },
    include: { identities: true, broker: true, ownedBroker: true, credentials: { where: { active: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!member) throw new RegistrationError("No encontramos la cuenta.", 404);
  const rawQr = qrCredential(member.id);
  await db.nekudotCredential.upsert({
    where: { programKey_tokenHash: { programKey: NEKUDOT_PROGRAM_KEY, tokenHash: credentialHash(rawQr) } },
    create: { programKey: NEKUDOT_PROGRAM_KEY, memberId: member.id, tokenHash: credentialHash(rawQr), lastFour: rawQr.slice(-4), kind: "QR", label: "QR digital" },
    update: { memberId: member.id, active: true, revokedAt: null, revokedReason: null },
  });
  await ensureBarcodeCredential(member.id);
  const credentials = await db.nekudotCredential.findMany({ where: { memberId: member.id, active: true }, orderBy: { createdAt: "asc" } });
  return {
    ...member,
    credentials,
    availableCents: member.balanceCents - member.reservedCents,
    qrDataUrl: await QRCode.toDataURL(rawQr, { width: 360, margin: 2, errorCorrectionLevel: "M" }),
    barcodeDataUrl: await barcodeDataUrl(member.id),
    credentialLastFour: rawQr.slice(-4),
    cardNumber: publicCardNumber(member.id),
  };
}

export async function memberOrders(memberId: string) {
  const identity = await db.nekudotCustomerIdentity.findFirst({ where: { memberId }, orderBy: { updatedAt: "desc" } });
  if (!identity) return [];
  const { admin } = await unauthenticated.admin(identity.shop);
  const data = await graphql<{ customer: null | { orders: { nodes: Array<{
    id: string; name: string; processedAt: string; displayFinancialStatus: string; displayFulfillmentStatus: string;
    currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
    lineItems: { nodes: Array<{
      quantity: number;
      product: { handle: string; title: string } | null;
      variant: { id: string; title: string } | null;
    }> };
  }> } } }>(admin, `#graphql
    query NekudotPortalOrders($id: ID!) {
      customer(id: $id) {
        orders(first: 20, sortKey: PROCESSED_AT, reverse: true) {
          nodes {
            id name processedAt displayFinancialStatus displayFulfillmentStatus
            currentTotalPriceSet { shopMoney { amount currencyCode } }
            lineItems(first: 20) {
              nodes {
                quantity
                product { handle title }
                variant { id title }
              }
            }
          }
        }
      }
    }
  `, { id: identity.shopifyCustomerId });
  const orders = data.customer?.orders.nodes || [];
  const accruals = await db.nekudotOrderAccrual.findMany({
    where: { shop: identity.shop, memberId, shopifyOrderId: { in: orders.map((order) => order.id) } },
  });
  const byOrder = new Map(accruals.map((accrual) => [accrual.shopifyOrderId, accrual]));
  return orders.map((order) => {
    const accrual = byOrder.get(order.id);
    return {
      ...order,
      clientEarnedCents: accrual?.clientEarnedCents ?? 0,
      brokerEarnedCents: accrual?.brokerEarnedCents ?? 0,
      cashbackProcessed: Boolean(accrual),
    };
  });
}

export async function readMemberPhoto(fileName: string) {
  if (!/^[a-z0-9]+-[a-f0-9]{16}\.(?:jpg|png|webp)$/.test(fileName)) throw new RegistrationError("Foto no válida.", 404);
  return readFile(path.join(photoDirectory(), fileName));
}
