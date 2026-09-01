import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import bwipjs from "bwip-js";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import db from "./db.server";
import { NEKUDOT_PROGRAM_KEY, type NekudotCardTier } from "./nekudot-domain";
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

export function normalizeMexicanPhone(value: unknown) {
  const digits = String(value || "").replace(/\D/g, "");
  const normalized = digits.length === 10 ? `+52${digits}` : `+${digits}`;
  if (!/^\+[1-9]\d{9,14}$/.test(normalized)) throw new RegistrationError("Escribe un teléfono válido con 10 dígitos.");
  return normalized;
}

function cleanText(value: unknown, label: string, max = 100) {
  const result = String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, max);
  if (result.length < 2) throw new RegistrationError(`Escribe ${label}.`);
  return result;
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

function qrCredential(memberId: string) {
  return `NKD1-${createHmac("sha256", hmacSecret()).update(`qr:${memberId}`).digest("base64url").slice(0, 32)}`;
}

async function barcodeDataUrl(memberId: string) {
  const png = await bwipjs.toBuffer({
    bcid: "code128",
    text: qrCredential(memberId),
    height: 12,
    includetext: false,
    backgroundcolor: "FFFFFF",
    paddingwidth: 8,
    paddingheight: 6,
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

function credentialHash(rawToken: string) {
  return createHmac("sha256", hmacSecret()).update(`${NEKUDOT_PROGRAM_KEY}:${rawToken}`).digest("hex");
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

export async function registerNekudot(formData: FormData, kindValue: unknown) {
  const kind = registrationKind(kindValue);
  const option = REGISTRATION_OPTIONS[kind];
  if (kind === "golden") goldenPaymentConfiguration();
  if (String(formData.get("website") || "")) throw new RegistrationError("No se pudo procesar el registro.");
  const broker = kind === "blue" ? await brokerForInviteCode(formData.get("ibCode")) : null;
  const firstName = cleanText(formData.get("firstName"), "tu nombre", 60);
  const lastName = cleanText(formData.get("lastName"), "tus apellidos", 80);
  const community = cleanText(formData.get("community"), "tu comunidad", 100);
  const email = String(formData.get("email") || "").trim().toLowerCase().slice(0, 180);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new RegistrationError("Escribe un correo electrónico válido.");
  const phone = normalizeMexicanPhone(formData.get("phone"));
  if (formData.get("privacy") !== "yes") throw new RegistrationError("Debes aceptar el aviso de privacidad.");

  const shop = registrationShop();
  const { admin } = await unauthenticated.admin(shop);
  let customer = await findCustomer(admin, email, phone);
  if (customer) {
    const customerEmail = customer.defaultEmailAddress?.emailAddress?.trim().toLowerCase() || "";
    const customerPhone = customer.defaultPhoneNumber?.phoneNumber?.trim() || "";
    if (customerEmail !== email || customerPhone !== phone) {
      throw new RegistrationError("Ya existe un cliente con parte de estos datos. Entra con el teléfono registrado o solicita ayuda para vincular la cuenta.", 409);
    }
  }
  if (!customer) customer = await createCustomer(admin, { firstName, lastName, email, phone, tag: option.tag });
  else await setCustomerTags(admin, customer.id, option.tag);

  const displayName = `${firstName} ${lastName}`;
  const member = await db.$transaction(async (transaction) => {
    const identity = await transaction.nekudotCustomerIdentity.findUnique({
      where: { shop_shopifyCustomerId: { shop, shopifyCustomerId: customer!.id } },
    });
    const existing = identity ? await transaction.nekudotMember.findUnique({ where: { id: identity.memberId } }) : null;
    const saved = existing
      ? await transaction.nekudotMember.update({
        where: { id: existing.id },
        data: { displayName, email, phone, community, cardTier: option.tier, enrollmentStatus: option.status, active: option.status === "ACTIVE", ...(broker ? { brokerId: broker.id } : {}) },
      })
      : await transaction.nekudotMember.create({
        data: { programKey: NEKUDOT_PROGRAM_KEY, displayName, email, phone, community, cardTier: option.tier, enrollmentStatus: option.status, active: option.status === "ACTIVE", brokerId: broker?.id || null },
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
    return saved;
  });
  const photoFileName = await savePhoto(member.id, formData.get("photo"));
  if (photoFileName) await db.nekudotMember.update({ where: { id: member.id }, data: { photoFileName } });
  const checkoutUrl = kind === "golden" ? await createGoldenPayment(member.id, displayName, email) : null;
  return {
    memberId: member.id,
    displayName,
    community,
    status: option.status,
    cardTitle: option.title,
    ibName: broker?.displayName || null,
    checkoutUrl,
    qrDataUrl: await QRCode.toDataURL(qrCredential(member.id), { width: 360, margin: 2, errorCorrectionLevel: "M" }),
    barcodeDataUrl: await barcodeDataUrl(member.id),
    credentialLastFour: qrCredential(member.id).slice(-4),
  };
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
  return db.$transaction(async (transaction) => {
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
}

export async function sendPortalOtp(phoneValue: unknown) {
  const phone = normalizeMexicanPhone(phoneValue);
  const member = await db.nekudotMember.findFirst({ where: { programKey: NEKUDOT_PROGRAM_KEY, phone } });
  if (!member) {
    const { customer } = await shopifyCustomerForPhone(phone);
    if (!customer) return { phone, sent: true };
  }
  if (process.env.NODE_ENV !== "production" && process.env.NEKUDOT_DEV_OTP) return { phone, sent: true };
  await twilioPost("Verifications", new URLSearchParams({ To: phone, Channel: "sms", Locale: "es" }));
  return { phone, sent: true };
}

export async function verifyPortalOtp(phoneValue: unknown, codeValue: unknown) {
  const phone = normalizeMexicanPhone(phoneValue);
  const code = String(codeValue || "").trim();
  let approved = process.env.NODE_ENV !== "production" && Boolean(process.env.NEKUDOT_DEV_OTP) && secureEquals(code, process.env.NEKUDOT_DEV_OTP || "");
  if (!approved) {
    const result = await twilioPost("VerificationCheck", new URLSearchParams({ To: phone, Code: code }));
    approved = result.status === "approved";
  }
  if (!approved) throw new RegistrationError("El código no es correcto o ya venció.", 401);
  let member = await db.nekudotMember.findFirst({ where: { programKey: NEKUDOT_PROGRAM_KEY, phone } });
  if (!member) member = await createSilverMemberForExistingCustomer(phone);
  if (!member) throw new RegistrationError("No encontramos una cuenta Nekudot con ese teléfono.", 404);
  const token = randomBytes(32).toString("base64url");
  await db.nekudotPortalSession.create({
    data: { tokenHash: createHash("sha256").update(token).digest("hex"), memberId: member.id, expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000) },
  });
  return { member, cookie: `${PORTAL_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}${process.env.NODE_ENV === "production" ? "; Secure" : ""}` };
}

export async function sendBrokerOtp(phoneValue: unknown) {
  const phone = normalizeMexicanPhone(phoneValue);
  const broker = await brokerForPhone(phone);
  if (!broker) return { phone, sent: true };
  if (process.env.NODE_ENV !== "production" && process.env.NEKUDOT_DEV_OTP) return { phone, sent: true };
  await twilioPost("Verifications", new URLSearchParams({ To: phone, Channel: "sms", Locale: "es" }));
  return { phone, sent: true };
}

export async function verifyBrokerOtp(phoneValue: unknown, codeValue: unknown) {
  const phone = normalizeMexicanPhone(phoneValue);
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
      return normalizeMexicanPhone(broker.phone) === phone;
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
  const member = await db.nekudotMember.findUnique({ where: { id: memberId }, include: { identities: true } });
  if (!member) throw new RegistrationError("No encontramos la cuenta.", 404);
  return {
    ...member,
    availableCents: member.balanceCents - member.reservedCents,
    qrDataUrl: await QRCode.toDataURL(qrCredential(member.id), { width: 360, margin: 2, errorCorrectionLevel: "M" }),
    barcodeDataUrl: await barcodeDataUrl(member.id),
    credentialLastFour: qrCredential(member.id).slice(-4),
  };
}

export async function memberOrders(memberId: string) {
  const identity = await db.nekudotCustomerIdentity.findFirst({ where: { memberId }, orderBy: { updatedAt: "desc" } });
  if (!identity) return [];
  const { admin } = await unauthenticated.admin(identity.shop);
  const data = await graphql<{ customer: null | { orders: { nodes: Array<{
    id: string; name: string; processedAt: string; displayFinancialStatus: string; displayFulfillmentStatus: string;
    currentTotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  }> } } }>(admin, `#graphql
    query NekudotPortalOrders($id: ID!) {
      customer(id: $id) {
        orders(first: 20, sortKey: PROCESSED_AT, reverse: true) {
          nodes { id name processedAt displayFinancialStatus displayFulfillmentStatus currentTotalPriceSet { shopMoney { amount currencyCode } } }
        }
      }
    }
  `, { id: identity.shopifyCustomerId });
  return data.customer?.orders.nodes || [];
}

export async function readMemberPhoto(fileName: string) {
  if (!/^[a-z0-9]+-[a-f0-9]{16}\.(?:jpg|png|webp)$/.test(fileName)) throw new RegistrationError("Foto no válida.", 404);
  return readFile(path.join(photoDirectory(), fileName));
}
