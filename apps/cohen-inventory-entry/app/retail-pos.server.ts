import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import db from "./db.server";
import { unauthenticated } from "./shopify.server";
import {
  assertCartInput,
  includedTaxCents,
  normalizeCafeName,
  parseMoneyToCents,
  parseShopifyMoneyToCents,
  safeIdempotencyKey,
  type CafeReceiptItem,
} from "./cafe-pos-domain";
import {
  bindNekudotCredential,
  cancelNekudotReservation,
  listShopifyCustomers,
  lookupNekudotMember,
  replaceNekudotCredential,
  renewNekudotReservation,
  reserveNekudot,
  searchShopifyCustomers,
} from "./nekudot.server";
import { cashbackBasisPointsForTier } from "./nekudot-domain";
import { parseOptionalNekudotMoney } from "./pos-nekudot-money";

const POS_COOKIE = "cohens_retail_pos";
const SESSION_HOURS = 12;
const loginAttempts = new Map<string, { failures: number; blockedUntil: number }>();
const managerAttempts = new Map<string, { failures: number; blockedUntil: number }>();

export class RetailPosError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "RETAIL_POS_ERROR",
  ) {
    super(message);
  }
}

function configuredShop() {
  // Retail and café are separate Shopify stores. Never fall back to the café
  // domain here: doing so can expose the wrong catalog at the supermarket POS.
  const shop = process.env.RETAIL_SHOP_DOMAIN?.trim().toLowerCase();
  if (!shop || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    throw new RetailPosError("La tienda de la Retail POS no está configurada.", 503, "RETAIL_SHOP_NOT_CONFIGURED");
  }
  return shop;
}

export function assertRetailPosEnabled() {
  if (process.env.RETAIL_POS_ENABLED === "false") {
    throw new RetailPosError("La Retail POS está deshabilitada.", 404, "RETAIL_POS_DISABLED");
  }
  return configuredShop();
}

export function assertRetailAdminShop(shop: string) {
  const expected = configuredShop();
  if (shop.toLowerCase() !== expected) {
    throw new RetailPosError("Esta Retail POS pertenece a otra tienda.", 403, "WRONG_RETAIL_SHOP");
  }
  return expected;
}

function pinDigest(pin: string, salt: string) {
  return scryptSync(pin, salt, 64);
}

function tokenDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function cookies(request: Request) {
  return Object.fromEntries(
    (request.headers.get("Cookie") ?? "")
      .split(";")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf("=");
        return separator === -1
          ? [entry, ""]
          : [entry.slice(0, separator), decodeURIComponent(entry.slice(separator + 1))];
      }),
  );
}

export function retailSessionCookie(token: string) {
  const maxAge = SESSION_HOURS * 60 * 60;
  return `${POS_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export function clearRetailSessionCookie() {
  return `${POS_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function assertRetailSameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return;
  const allowed = new Set([new URL(request.url).origin]);
  const configuredUrl = process.env.SHOPIFY_APP_URL;
  if (configuredUrl) allowed.add(new URL(configuredUrl).origin);
  const forwardedHost = request.headers.get("X-Forwarded-Host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("X-Forwarded-Proto")?.split(",")[0]?.trim();
  if (forwardedHost && forwardedProto) allowed.add(`${forwardedProto}://${forwardedHost}`);
  if (!allowed.has(origin)) {
    throw new RetailPosError("La solicitud no proviene de la Retail POS autorizada.", 403, "ORIGIN_REJECTED");
  }
}

function managerConfig() {
  const name = (process.env.RETAIL_MANAGER_NAME || process.env.CAFE_MANAGER_NAME)?.trim().replace(/\s+/g, " ");
  const pin = (process.env.RETAIL_MANAGER_PIN || process.env.CAFE_MANAGER_PIN)?.trim();
  if (!name || name.length < 2 || name.length > 80 || !pin || !/^\d{4,8}$/.test(pin)) {
    throw new RetailPosError("El acceso del gerente retail no está configurado.", 503, "MANAGER_NOT_CONFIGURED");
  }
  return { name, pin };
}

function managerPinMatches(value: string) {
  const expected = managerConfig().pin;
  if (!/^\d{4,8}$/.test(value) || value.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

export async function createRetailStaff(shop: string, name: string, pin: string, role = "CASHIER") {
  assertRetailAdminShop(shop);
  const trimmedName = name.trim().replace(/\s+/g, " ");
  if (trimmedName.length < 2 || trimmedName.length > 80) {
    throw new RetailPosError("El nombre debe contener entre 2 y 80 caracteres.");
  }
  if (!/^\d{4,8}$/.test(pin)) throw new RetailPosError("El PIN debe contener entre 4 y 8 dígitos.");
  if (!new Set(["CASHIER", "MANAGER"]).has(role)) throw new RetailPosError("El rol no es válido.");
  if (role !== "MANAGER" && managerPinMatches(pin)) {
    throw new RetailPosError("Ese PIN está reservado para el gerente.", 409, "PIN_RESERVED");
  }
  const normalizedName = normalizeCafeName(trimmedName);
  const existing = await db.retailStaff.findMany({ where: { shop } });
  const duplicatePin = existing.find((candidate) => {
    if (candidate.normalizedName === normalizedName) return false;
    const expected = Buffer.from(candidate.pinHash, "hex");
    const received = pinDigest(pin, candidate.pinSalt);
    return expected.length === received.length && timingSafeEqual(expected, received);
  });
  if (duplicatePin) throw new RetailPosError("Ese PIN ya pertenece a otro usuario.", 409, "PIN_ALREADY_USED");
  const salt = randomBytes(16).toString("hex");
  return db.retailStaff.upsert({
    where: { shop_normalizedName: { shop, normalizedName } },
    create: {
      shop, name: trimmedName, normalizedName, pinSalt: salt,
      pinHash: pinDigest(pin, salt).toString("hex"), role,
    },
    update: {
      name: trimmedName, pinSalt: salt, pinHash: pinDigest(pin, salt).toString("hex"), role, active: true,
    },
  });
}

export function listRetailStaff(shop: string) {
  assertRetailAdminShop(shop);
  return db.retailStaff.findMany({
    where: { shop },
    select: { id: true, name: true, role: true, active: true, createdAt: true, updatedAt: true },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

export async function setRetailStaffActive(shop: string, staffId: string, active: boolean) {
  assertRetailAdminShop(shop);
  const staff = await db.retailStaff.findFirst({ where: { id: staffId, shop } });
  if (!staff) throw new RetailPosError("No se encontró el empleado.", 404);
  if (staff.role === "MANAGER" && !active) {
    throw new RetailPosError("El gerente principal no se puede desactivar.", 409, "MANAGER_REQUIRED");
  }
  await db.$transaction([
    db.retailStaff.update({ where: { id: staff.id }, data: { active } }),
    ...(!active
      ? [db.retailPosSession.updateMany({ where: { staffId: staff.id, revokedAt: null }, data: { revokedAt: new Date() } })]
      : []),
  ]);
}

function requestKey(request: Request) {
  const forwarded = request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  return `${configuredShop()}:${forwarded || "unknown"}`;
}

function recordAttempt(store: Map<string, { failures: number; blockedUntil: number }>, key: string, success: boolean, error: string) {
  const attempt = store.get(key);
  if (attempt && attempt.blockedUntil > Date.now()) {
    throw new RetailPosError("Demasiados intentos. Espera cinco minutos.", 429, "PIN_BLOCKED");
  }
  if (success) {
    store.delete(key);
    return;
  }
  const failures = (attempt?.failures ?? 0) + 1;
  store.set(key, { failures: failures >= 5 ? 0 : failures, blockedUntil: failures >= 5 ? Date.now() + 300_000 : 0 });
  throw new RetailPosError(error, 403, "PIN_INVALID");
}

export async function requireRetailManager(request: Request, pin?: unknown) {
  const session = await currentRetailSession(request);
  if (session!.staff.role === "MANAGER") return { session: session!, managerName: session!.staff.name };
  const matches = managerPinMatches(String(pin ?? ""));
  recordAttempt(managerAttempts, `${requestKey(request)}:manager`, matches, "PIN de gerente incorrecto.");
  return { session: session!, managerName: managerConfig().name };
}

export async function loginRetailStaff(request: Request, pin: string) {
  const shop = assertRetailPosEnabled();
  if (!/^\d{4,8}$/.test(pin)) throw new RetailPosError("PIN incorrecto.", 401, "PIN_INVALID");
  const key = requestKey(request);
  const attempt = loginAttempts.get(key);
  if (attempt && attempt.blockedUntil > Date.now()) {
    throw new RetailPosError("Demasiados intentos. Espera cinco minutos.", 429, "PIN_BLOCKED");
  }
  if (managerPinMatches(pin)) {
    const manager = managerConfig();
    await createRetailStaff(shop, manager.name, manager.pin, "MANAGER");
  }
  const staffMembers = await db.retailStaff.findMany({ where: { shop, active: true } });
  const staff = staffMembers.find((candidate) => {
    const expected = Buffer.from(candidate.pinHash, "hex");
    const received = pinDigest(pin, candidate.pinSalt);
    return expected.length === received.length && timingSafeEqual(expected, received);
  });
  if (!staff) {
    const failures = (attempt?.failures ?? 0) + 1;
    loginAttempts.set(key, { failures: failures >= 5 ? 0 : failures, blockedUntil: failures >= 5 ? Date.now() + 300_000 : 0 });
    throw new RetailPosError("PIN incorrecto.", 401, "PIN_INVALID");
  }
  loginAttempts.delete(key);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  await db.retailPosSession.create({ data: { shop, staffId: staff.id, tokenHash: tokenDigest(token), expiresAt } });
  return { token, staff: { id: staff.id, name: staff.name, role: staff.role }, expiresAt };
}

export async function currentRetailSession(request: Request, required = true) {
  const shop = assertRetailPosEnabled();
  const token = cookies(request)[POS_COOKIE];
  if (!token) {
    if (required) throw new RetailPosError("Inicia sesión para usar la Retail POS.", 401, "AUTH_REQUIRED");
    return null;
  }
  const session = await db.retailPosSession.findUnique({ where: { tokenHash: tokenDigest(token) }, include: { staff: true } });
  if (!session || session.shop !== shop || session.revokedAt || session.expiresAt.getTime() <= Date.now() || !session.staff.active) {
    if (required) throw new RetailPosError("La sesión expiró. Vuelve a ingresar tu PIN.", 401, "AUTH_EXPIRED");
    return null;
  }
  if (Date.now() - session.lastSeenAt.getTime() > 300_000) {
    await db.retailPosSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return session;
}

export async function logoutRetailStaff(request: Request) {
  const token = cookies(request)[POS_COOKIE];
  if (token) {
    await db.retailPosSession.updateMany({ where: { tokenHash: tokenDigest(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }
}

type GraphqlAdmin = Awaited<ReturnType<typeof unauthenticated.admin>>["admin"];

async function adminContext() {
  const shop = assertRetailPosEnabled();
  const { admin } = await unauthenticated.admin(shop);
  return { shop, admin };
}

async function graphql<T>(admin: GraphqlAdmin, query: string, variables: Record<string, unknown> = {}) {
  const response = await admin.graphql(query, { variables });
  const payload = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (payload.errors?.length) throw new RetailPosError(payload.errors.map((error) => error.message).join("; "), 502, "SHOPIFY_GRAPHQL");
  if (!payload.data) throw new RetailPosError("Shopify no devolvió datos.", 502, "SHOPIFY_EMPTY");
  return payload.data;
}

export async function retailLocation(admin?: GraphqlAdmin) {
  const context = admin ? { admin } : await adminContext();
  const data = await graphql<{ locations: { nodes: Array<{ id: string; name: string; isActive: boolean }> } }>(context.admin, `#graphql
    query RetailPosLocations {
      locations(first: 25, includeInactive: false) { nodes { id name isActive } }
    }
  `);
  const expectedName = process.env.RETAIL_LOCATION_NAME?.trim() || "Plaza Victoria";
  const location = data.locations.nodes.find((item) => item.name === expectedName) ?? data.locations.nodes.find((item) => item.isActive);
  if (!location) throw new RetailPosError("Shopify no tiene una ubicación activa.", 503, "LOCATION_MISSING");
  return location;
}

export async function getRetailCatalog(search = "") {
  const { admin } = await adminContext();
  const location = await retailLocation(admin);
  const term = search.trim().slice(0, 80);
  const safeTerm = term.replace(/["'():\\]/g, " ").replace(/\s+/g, " ").trim();
  const productQuery = safeTerm.length >= 2
    ? `product_status:active AND (title:*${safeTerm}* OR sku:${safeTerm} OR barcode:${safeTerm})`
    : "product_status:active";
  type ShopifyVariant = {
    id: string; title: string; sku: string | null; barcode: string | null; price: string;
    inventoryPolicy: "DENY" | "CONTINUE";
    product: {
      id: string; title: string; handle: string; vendor: string; productType: string;
      featuredMedia: { preview: { image: { url: string; altText: string | null } | null } | null } | null;
    };
    inventoryItem: {
      id: string; tracked: boolean;
      inventoryLevel: { quantities: Array<{ name: string; quantity: number }> } | null;
    };
  };
  const variants: ShopifyVariant[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;
  let pageCount = 0;

  // Shopify limits each connection page. Paginating variants at the root also
  // avoids silently losing products with more than 100 variants.
  while (hasNextPage) {
    if (pageCount >= 100) {
      throw new RetailPosError("El catálogo excede el límite seguro de 25,000 variantes.", 502, "CATALOG_TOO_LARGE");
    }
    const data: {
      productVariants: {
        nodes: ShopifyVariant[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await graphql(admin, `#graphql
      query RetailPosCatalog($locationId: ID!, $query: String!, $cursor: String) {
        productVariants(first: 250, after: $cursor, query: $query, sortKey: TITLE) {
          nodes {
            id title sku barcode price inventoryPolicy
            product {
              id title handle vendor productType
              featuredMedia { preview { image { url altText } } }
            }
            inventoryItem {
              id tracked
              inventoryLevel(locationId: $locationId) { quantities(names: ["available"]) { name quantity } }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { locationId: location.id, query: productQuery, cursor });
    variants.push(...data.productVariants.nodes);
    hasNextPage = data.productVariants.pageInfo.hasNextPage;
    cursor = data.productVariants.pageInfo.endCursor;
    pageCount += 1;
    if (hasNextPage && !cursor) {
      throw new RetailPosError("Shopify indicó más catálogo pero no devolvió cursor.", 502, "CATALOG_CURSOR_MISSING");
    }
  }

  const productMap = new Map<string, {
    id: string; title: string; handle: string; vendor: string; productType: string;
    imageUrl: string | null; imageAlt: string; variants: Array<{
      id: string; title: string; sku: string | null; barcode: string | null;
      priceCents: number; tracked: boolean; available: number; inventoryPolicy: "DENY" | "CONTINUE";
    }>;
  }>();
  for (const variant of variants) {
    let product = productMap.get(variant.product.id);
    if (!product) {
      product = {
        id: variant.product.id,
        title: variant.product.title,
        handle: variant.product.handle,
        vendor: variant.product.vendor,
        productType: variant.product.productType,
        imageUrl: variant.product.featuredMedia?.preview?.image?.url ?? null,
        imageAlt: variant.product.featuredMedia?.preview?.image?.altText ?? variant.product.title,
        variants: [],
      };
      productMap.set(product.id, product);
    }
    product.variants.push({
      id: variant.id,
      title: variant.title,
      sku: variant.sku,
      barcode: variant.barcode,
      priceCents: parseShopifyMoneyToCents(variant.price),
      tracked: variant.inventoryItem.tracked,
      available: variant.inventoryItem.inventoryLevel?.quantities.find((quantity) => quantity.name === "available")?.quantity ?? 0,
      inventoryPolicy: variant.inventoryPolicy,
    });
  }
  const products = [...productMap.values()].sort((left, right) => left.title.localeCompare(right.title, "es-MX"));
  return {
    location,
    products,
    productCount: products.length,
    variantCount: variants.length,
    syncedAt: new Date().toISOString(),
  };
}

export async function searchRetailCustomers(request: Request, search: string) {
  const session = await currentRetailSession(request);
  const { admin } = await adminContext();
  const hasSearch = Boolean(search.trim());
  const customers = hasSearch
    ? await searchShopifyCustomers(admin, search)
    : await listShopifyCustomers(admin);
  const identities = customers.length
    ? await db.nekudotCustomerIdentity.findMany({
        where: hasSearch
          ? { shop: session!.shop, shopifyCustomerId: { in: customers.map((customer) => customer.id) } }
          : { shop: session!.shop },
        include: {
          member: {
            include: {
              broker: true,
              credentials: { where: { active: true }, orderBy: { updatedAt: "desc" } },
            },
          },
        },
      })
    : [];
  const byCustomerId = new Map(identities.map((identity) => [identity.shopifyCustomerId, identity.member]));
  return customers.map((customer) => {
    const member = byCustomerId.get(customer.id);
    return {
      ...customer,
      member: member?.active
        ? {
            id: member.id,
            cardTier: member.cardTier,
            cashbackBasisPoints: cashbackBasisPointsForTier(member.cardTier),
            availableCents: member.balanceCents - member.reservedCents,
            balanceCents: member.balanceCents,
            reservedCents: member.reservedCents,
            credentialCount: member.credentials.length,
            credentialLastFour: member.credentials[0]?.lastFour ?? null,
            broker: member.broker ? { displayName: member.broker.displayName, code: member.broker.code } : null,
          }
        : null,
    };
  });
}

export async function assignRetailCustomerCredential(request: Request, input: {
  customerId: unknown;
  credential: unknown;
  label?: unknown;
  managerPin?: unknown;
  replace?: unknown;
  identityVerified?: unknown;
  cardTier?: unknown;
}) {
  const authorization = await requireRetailManager(request, input.managerPin);
  const { admin } = await adminContext();
  const customerId = String(input.customerId ?? "");
  const rawToken = input.credential;
  const replacing = input.replace === true || input.replace === "true";
  const member = replacing
    ? await replaceNekudotCredential({
        admin,
        shop: authorization.session.shop,
        customerId,
        rawToken,
        kind: "RFID_OR_QR",
        label: input.label || "Tarjeta reemplazada en Retail POS",
        identityVerified: input.identityVerified,
        cardTier: input.cardTier,
      })
    : await bindNekudotCredential({
        admin,
        shop: authorization.session.shop,
        customerId,
        rawToken,
        kind: "RFID_OR_QR",
        label: input.label || "Tarjeta asignada en Retail POS",
        cardTier: input.cardTier,
      });
  return {
    id: member.id,
    displayName: member.displayName,
    email: member.email,
    cardTier: member.cardTier,
    cashbackBasisPoints: cashbackBasisPointsForTier(member.cardTier),
    availableCents: member.balanceCents - member.reservedCents,
    balanceCents: member.balanceCents,
    reservedCents: member.reservedCents,
    credentialCount: member.credentials.filter((credential) => credential.active).length,
    credentialLastFour: member.credentials.find((credential) => credential.active)?.lastFour ?? null,
    broker: member.broker ? { displayName: member.broker.displayName, code: member.broker.code } : null,
  };
}

export async function currentRetailShift(shop = configuredShop()) {
  return db.retailRegisterShift.findFirst({
    where: { shop, status: "OPEN" },
    include: { staff: { select: { id: true, name: true } } },
    orderBy: { openedAt: "desc" },
  });
}

export async function openRetailShift(request: Request, openingCash: unknown) {
  const session = await currentRetailSession(request);
  const openingCashCents = parseMoneyToCents(openingCash, "El fondo inicial");
  const existing = await currentRetailShift(session!.shop);
  if (existing) throw new RetailPosError(`Ya existe un turno abierto por ${existing.staff.name}.`, 409, "SHIFT_ALREADY_OPEN");
  return db.retailRegisterShift.create({
    data: { shop: session!.shop, staffId: session!.staffId, openingCashCents },
    include: { staff: { select: { id: true, name: true } } },
  });
}

export async function closeRetailShift(request: Request, input: { closingCash: unknown; terminalCounted: unknown; notes?: unknown }) {
  const session = await currentRetailSession(request);
  const shift = await currentRetailShift(session!.shop);
  if (!shift) throw new RetailPosError("No hay un turno abierto.", 409, "SHIFT_NOT_OPEN");
  const totals = await db.retailSale.aggregate({
    where: { shiftId: shift.id, status: { in: ["SYNCED", "PENDING_SYNC"] } },
    _sum: { cashPaidCents: true, terminalPaidCents: true },
  });
  const cashSales = totals._sum.cashPaidCents ?? 0;
  const terminalSales = totals._sum.terminalPaidCents ?? 0;
  const closingCashCents = parseMoneyToCents(input.closingCash, "El efectivo contado");
  const terminalCountedCents = parseMoneyToCents(input.terminalCounted, "El total de terminal");
  const expectedCashCents = shift.openingCashCents + cashSales;
  return db.retailRegisterShift.update({
    where: { id: shift.id },
    data: {
      status: "CLOSED", closedAt: new Date(), closingCashCents, expectedCashCents,
      cashVarianceCents: closingCashCents - expectedCashCents,
      terminalCountedCents, terminalExpectedCents: terminalSales,
      terminalVarianceCents: terminalCountedCents - terminalSales,
      notes: String(input.notes ?? "").trim().slice(0, 500) || null,
    },
    include: { staff: { select: { id: true, name: true } } },
  });
}

type ResolvedVariant = {
  id: string; title: string; sku: string | null; barcode: string | null; price: string;
  product: { id: string; title: string; status: string; vendor: string };
  inventoryItem: { tracked: boolean; inventoryLevel: { quantities: Array<{ name: string; quantity: number }> } | null };
};

async function resolveCart(admin: GraphqlAdmin, locationId: string, rawItems: unknown) {
  const items = assertCartInput(rawItems);
  const data = await graphql<{ nodes: Array<ResolvedVariant | null> }>(admin, `#graphql
    query RetailPosVariants($ids: [ID!]!, $locationId: ID!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id title sku barcode price
          product { id title status vendor }
          inventoryItem {
            tracked
            inventoryLevel(locationId: $locationId) { quantities(names: ["available"]) { name quantity } }
          }
        }
      }
    }
  `, { ids: items.map((item) => item.variantId), locationId });
  const byId = new Map(data.nodes.filter((node): node is ResolvedVariant => Boolean(node)).map((node) => [node.id, node]));
  return items.map((item) => {
    const variant = byId.get(item.variantId);
    if (!variant || variant.product.status !== "ACTIVE") throw new RetailPosError("Un producto ya no está disponible.", 409, "PRODUCT_UNAVAILABLE");
    const available = variant.inventoryItem.inventoryLevel?.quantities.find((quantity) => quantity.name === "available")?.quantity ?? 0;
    if (variant.inventoryItem.tracked && available < item.quantity) {
      throw new RetailPosError(`Existencia insuficiente para ${variant.product.title}. Disponible: ${available}.`, 409, "INSUFFICIENT_STOCK");
    }
    const unitPriceCents = parseShopifyMoneyToCents(variant.price);
    return {
      variantId: variant.id,
      productId: variant.product.id,
      title: variant.product.title,
      variantTitle: variant.title === "Default Title" ? null : variant.title,
      vendor: variant.product.vendor,
      sku: variant.sku,
      barcode: variant.barcode,
      quantity: item.quantity,
      unitPriceCents,
      totalCents: unitPriceCents * item.quantity,
    };
  });
}

function taxRateBasisPoints() {
  const value = Number(process.env.RETAIL_TAX_RATE_BPS ?? process.env.CAFE_TAX_RATE_BPS ?? "1600");
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new RetailPosError("RETAIL_TAX_RATE_BPS no es válido.", 503, "TAX_CONFIG_INVALID");
  }
  return value;
}

async function findShopifyOrderBySale(admin: GraphqlAdmin, saleId: string) {
  const data = await graphql<{ orders: { nodes: Array<{ id: string; name: string }> } }>(admin, `#graphql
    query RetailPosOrderReconciliation($query: String!) {
      orders(first: 1, query: $query) { nodes { id name } }
    }
  `, { query: `tag:retail-pos-${saleId}` });
  return data.orders.nodes[0] ?? null;
}

async function resolveCustomer(admin: GraphqlAdmin, customerId: unknown) {
  const id = String(customerId ?? "").trim();
  if (!id) return null;
  if (!/^gid:\/\/shopify\/Customer\/\d+$/.test(id)) throw new RetailPosError("El cliente de Shopify no es válido.");
  const data = await graphql<{ customer: { id: string; displayName: string; defaultEmailAddress: { emailAddress: string } | null } | null }>(admin, `#graphql
    query RetailPosCustomer($id: ID!) {
      customer(id: $id) { id displayName defaultEmailAddress { emailAddress } }
    }
  `, { id });
  if (!data.customer) throw new RetailPosError("Shopify no encontró al cliente.", 404, "CUSTOMER_NOT_FOUND");
  return {
    id: data.customer.id,
    name: data.customer.displayName || "Cliente sin nombre",
    email: data.customer.defaultEmailAddress?.emailAddress?.trim() || null,
  };
}

function paymentParts(raw: Record<string, unknown>, totalCents: number) {
  if (totalCents === 0) return { method: "NEKUDOT", cashPaidCents: 0, terminalPaidCents: 0, cashReceivedCents: null, changeCents: 0 };
  const method = String(raw.paymentMethod ?? "");
  if (!new Set(["CASH", "EXTERNAL_CARD", "SPLIT"]).has(method)) throw new RetailPosError("Selecciona una forma de pago.");
  if (method === "EXTERNAL_CARD") return { method, cashPaidCents: 0, terminalPaidCents: totalCents, cashReceivedCents: null, changeCents: 0 };
  const cashPaidCents = method === "CASH" ? totalCents : parseMoneyToCents(raw.cashPaid, "El importe en efectivo");
  if (method === "SPLIT" && (cashPaidCents <= 0 || cashPaidCents >= totalCents)) {
    throw new RetailPosError("En un pago mixto, el efectivo debe ser mayor a cero y menor al total.");
  }
  const cashReceivedCents = raw.cashReceived === undefined || raw.cashReceived === ""
    ? cashPaidCents
    : parseMoneyToCents(raw.cashReceived, "El efectivo recibido");
  if (cashReceivedCents < cashPaidCents) throw new RetailPosError("El efectivo recibido no cubre la parte en efectivo.");
  return {
    method,
    cashPaidCents,
    terminalPaidCents: totalCents - cashPaidCents,
    cashReceivedCents,
    changeCents: cashReceivedCents - cashPaidCents,
  };
}

export async function createRetailSale(request: Request, raw: Record<string, unknown>) {
  const session = await currentRetailSession(request);
  const idempotencyKey = safeIdempotencyKey(raw.idempotencyKey);
  let sale = await db.retailSale.findUnique({
    where: { shop_idempotencyKey: { shop: session!.shop, idempotencyKey } },
    include: { staff: { select: { name: true } } },
  });
  if (sale?.status === "SYNCED") return sale;
  const shift = sale
    ? await db.retailRegisterShift.findUnique({ where: { id: sale.shiftId }, include: { staff: { select: { id: true, name: true } } } })
    : await currentRetailShift(session!.shop);
  if (!shift || shift.status !== "OPEN") throw new RetailPosError("Abre un turno antes de vender.", 409, "SHIFT_NOT_OPEN");
  const { admin } = await adminContext();
  const location = await retailLocation(admin);
  const resolved = sale
    ? (sale.items as unknown as Array<CafeReceiptItem & { variantId: string; barcode?: string | null; vendor?: string }>)
    : await resolveCart(admin, location.id, raw.items);
  const grossCents = resolved.reduce((sum, item) => sum + item.totalCents, 0);
  const manualDiscountCents = sale?.discountCents ?? parseMoneyToCents(raw.discountAmount ?? 0, "El descuento");
  if (manualDiscountCents >= grossCents && grossCents > 0) throw new RetailPosError("El descuento debe ser menor al total de artículos.");
  if (!sale && manualDiscountCents > 0) await requireRetailManager(request, raw.managerPin);

  let nekudotMember = sale?.nekudotMemberId
    ? await db.nekudotMember.findUnique({ where: { id: sale.nekudotMemberId }, include: { identities: true, broker: true } })
    : null;
  let nekudotRedemption = sale?.nekudotRedemptionId
    ? await db.nekudotRedemption.findUnique({ where: { id: sale.nekudotRedemptionId } })
    : null;
  if (sale && nekudotRedemption && nekudotRedemption.status !== "APPLIED") {
    nekudotRedemption = await renewNekudotReservation(session!.shop, nekudotRedemption.id);
  }
  if (!sale && String(raw.nekudotCredential ?? "").trim()) {
    nekudotMember = await lookupNekudotMember(session!.shop, raw.nekudotCredential);
    const requestedAmount = String(raw.nekudotRedeemAmount ?? "").trim();
    const requestedCents = parseOptionalNekudotMoney(requestedAmount);
    if (requestedCents > grossCents - manualDiscountCents) throw new RetailPosError("El canje supera el total después del descuento.", 409, "NEKUDOT_EXCEEDS_TOTAL");
    if (requestedCents) {
      nekudotRedemption = await reserveNekudot({
        shop: session!.shop,
        rawToken: raw.nekudotCredential,
        amount: requestedAmount,
        cartTotalCents: grossCents - manualDiscountCents,
        cartReference: idempotencyKey,
        idempotencyKey: `retail-redemption:${idempotencyKey}`,
      });
    }
  }
  const nekudotRedeemedCents = nekudotRedemption?.amountCents ?? 0;
  const totalCents = grossCents - manualDiscountCents - nekudotRedeemedCents;
  const payment = sale
    ? {
        method: sale.paymentMethod,
        cashPaidCents: sale.cashPaidCents,
        terminalPaidCents: sale.terminalPaidCents,
        cashReceivedCents: sale.cashReceivedCents,
        changeCents: sale.changeCents,
      }
    : paymentParts(raw, totalCents);
  const currentShopIdentity = nekudotMember?.identities.find((identity) => identity.shop === session!.shop) ?? null;
  const selectedCustomer = sale?.customerId
    ? { id: sale.customerId, name: sale.customerName || "Cliente", email: sale.customerEmail }
    : await resolveCustomer(admin, raw.customerId || currentShopIdentity?.shopifyCustomerId);
  if (currentShopIdentity && selectedCustomer && currentShopIdentity.shopifyCustomerId !== selectedCustomer.id) {
    throw new RetailPosError("La tarjeta Cohen's pertenece a otro cliente de Shopify.", 409, "CUSTOMER_MEMBER_MISMATCH");
  }
  const rateBasisPoints = taxRateBasisPoints();
  const taxCents = includedTaxCents(totalCents, rateBasisPoints);
  if (!sale) {
    try {
      sale = await db.retailSale.create({
        data: {
          shop: session!.shop,
          idempotencyKey,
          staffId: session!.staffId,
          shiftId: shift.id,
          paymentMethod: payment.method,
          externalReference: String(raw.externalReference ?? "").trim().slice(0, 100) || null,
          grossCents,
          discountCents: manualDiscountCents,
          subtotalCents: totalCents - taxCents,
          taxCents,
          totalCents,
          cashPaidCents: payment.cashPaidCents,
          terminalPaidCents: payment.terminalPaidCents,
          cashReceivedCents: payment.cashReceivedCents,
          changeCents: payment.changeCents,
          items: resolved,
          customerId: selectedCustomer?.id ?? null,
          customerName: selectedCustomer?.name ?? null,
          customerEmail: selectedCustomer?.email ?? null,
          nekudotMemberId: nekudotMember?.id ?? null,
          nekudotRedemptionId: nekudotRedemption?.id ?? null,
          nekudotRedeemedCents,
        },
        include: { staff: { select: { name: true } } },
      });
    } catch (error) {
      if (nekudotRedemption) await cancelNekudotReservation(session!.shop, nekudotRedemption.id).catch(() => undefined);
      throw error;
    }
  }
  try {
    const reconciled = await findShopifyOrderBySale(admin, sale.id);
    if (reconciled) {
      return db.retailSale.update({
        where: { id: sale.id },
        data: { status: "SYNCED", shopifyOrderId: reconciled.id, shopifyOrderName: reconciled.name, syncedAt: new Date(), errorMessage: null },
        include: { staff: { select: { name: true } } },
      });
    }
    const currencyCode = "MXN";
    const taxRate = rateBasisPoints / 10_000;
    const transactions = [
      ...(sale.cashPaidCents > 0 ? [{ kind: "SALE", status: "SUCCESS", gateway: "Cash", locationId: location.id, amountSet: { shopMoney: { amount: (sale.cashPaidCents / 100).toFixed(2), currencyCode } } }] : []),
      ...(sale.terminalPaidCents > 0 ? [{ kind: "SALE", status: "SUCCESS", gateway: "External card terminal", locationId: location.id, amountSet: { shopMoney: { amount: (sale.terminalPaidCents / 100).toFixed(2), currencyCode } } }] : []),
    ];
    const totalDiscountCents = sale.discountCents + sale.nekudotRedeemedCents;
    const customAttributes = [
      { key: "retail_pos_sale_id", value: sale.id },
      { key: "retail_pos_staff", value: sale.staff.name },
      { key: "retail_pos_payment", value: sale.paymentMethod },
      ...(nekudotMember ? [{ key: "nekudot_member_id", value: nekudotMember.id }] : []),
      ...(nekudotRedemption ? [{ key: "nekudot_redemption_id", value: nekudotRedemption.id }] : []),
    ];
    const result = await graphql<{
      orderCreate: { order: { id: string; name: string } | null; userErrors: Array<{ message: string }> };
    }>(admin, `#graphql
      mutation RetailPosOrder($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
        orderCreate(order: $order, options: $options) { order { id name } userErrors { field message } }
      }
    `, {
      order: {
        currency: currencyCode,
        taxesIncluded: true,
        lineItems: resolved.map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
          taxLines: rateBasisPoints ? [{
            title: "IVA", rate: taxRate,
            priceSet: { shopMoney: { amount: (includedTaxCents(item.totalCents, rateBasisPoints) / 100).toFixed(2), currencyCode } },
          }] : [],
        })),
        ...(totalDiscountCents ? {
          discountCode: {
            itemFixedDiscountCode: {
              code: sale.nekudotRedeemedCents ? `NEKUDOT-${sale.id.slice(-8).toUpperCase()}` : `RETAIL-${sale.id.slice(-8).toUpperCase()}`,
              amountSet: { shopMoney: { amount: (totalDiscountCents / 100).toFixed(2), currencyCode } },
            },
          },
        } : {}),
        ...(sale.customerId ? { customer: { toAssociate: { id: sale.customerId } } } : {}),
        ...(transactions.length ? { transactions } : { financialStatus: "PAID" }),
        fulfillmentStatus: "FULFILLED",
        tags: ["cohens-retail", "retail-pos", `retail-pos-${sale.id}`],
        note: `Venta Cohen's Retail POS. Empleado: ${sale.staff.name}. Turno: ${shift.id}.`,
        customAttributes,
        processedAt: new Date().toISOString(),
      },
      options: { inventoryBehaviour: "DECREMENT_OBEYING_POLICY", sendReceipt: false, sendFulfillmentReceipt: false },
    });
    if (result.orderCreate.userErrors.length || !result.orderCreate.order) {
      throw new RetailPosError(result.orderCreate.userErrors.map((error) => error.message).join("; ") || "Shopify no creó el pedido.", 502, "ORDER_REJECTED");
    }
    return db.retailSale.update({
      where: { id: sale.id },
      data: { status: "SYNCED", shopifyOrderId: result.orderCreate.order.id, shopifyOrderName: result.orderCreate.order.name, syncedAt: new Date(), errorMessage: null },
      include: { staff: { select: { name: true } } },
    });
  } catch (error) {
    await db.retailSale.update({
      where: { id: sale.id },
      data: { status: "PENDING_SYNC", errorMessage: error instanceof Error ? error.message.slice(0, 1000) : "Error desconocido" },
    });
    throw new RetailPosError(`La venta quedó pendiente con folio ${sale.id}. No vuelvas a cobrar; usa Reintentar.`, 503, "ORDER_PENDING_SYNC");
  }
}

export async function recentRetailSales(request: Request, limit = 30) {
  const session = await currentRetailSession(request);
  return db.retailSale.findMany({
    where: { shop: session!.shop },
    include: { staff: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(limit, 100)),
  });
}

export async function refundRetailSale(request: Request, saleId: string, managerPin?: unknown) {
  const authorization = await requireRetailManager(request, managerPin);
  const sale = await db.retailSale.findFirst({
    where: { id: saleId, shop: authorization.session.shop },
    include: { staff: { select: { name: true } } },
  });
  if (!sale) throw new RetailPosError("No se encontró la venta.", 404, "SALE_NOT_FOUND");
  if (sale.status === "REFUNDED") return sale;
  if (sale.status !== "SYNCED" || !sale.shopifyOrderId) throw new RetailPosError("Solo se reembolsan pedidos sincronizados.", 409, "SALE_NOT_REFUNDABLE");
  const { admin } = await adminContext();
  const location = await retailLocation(admin);
  const orderData = await graphql<{
    order: {
      lineItems: { nodes: Array<{ id: string; refundableQuantity: number }> };
      transactions: Array<{ id: string; kind: string; status: string; gateway: string; amountSet: { shopMoney: { amount: string } } }>;
    } | null;
  }>(admin, `#graphql
    query RetailPosRefundOrder($id: ID!) {
      order(id: $id) {
        lineItems(first: 100) { nodes { id refundableQuantity } }
        transactions(first: 20) { id kind status gateway amountSet { shopMoney { amount } } }
      }
    }
  `, { id: sale.shopifyOrderId });
  if (!orderData.order) throw new RetailPosError("Shopify no encontró el pedido.", 404, "SHOPIFY_ORDER_NOT_FOUND");
  const parents = orderData.order.transactions.filter((transaction) => transaction.status === "SUCCESS" && (transaction.kind === "SALE" || transaction.kind === "CAPTURE"));
  const refundLineItems = orderData.order.lineItems.nodes
    .filter((item) => item.refundableQuantity > 0)
    .map((item) => ({ lineItemId: item.id, quantity: item.refundableQuantity, restockType: "RETURN", locationId: location.id }));
  if (!refundLineItems.length) throw new RetailPosError("El pedido ya no contiene artículos reembolsables.", 409, "ALREADY_REFUNDED");
  const refundKey = sale.refundIdempotencyKey ?? randomUUID();
  if (!sale.refundIdempotencyKey) await db.retailSale.update({ where: { id: sale.id }, data: { refundIdempotencyKey: refundKey } });
  const result = await graphql<{
    refundCreate: { refund: { id: string } | null; userErrors: Array<{ message: string }> };
  }>(admin, `#graphql
    mutation RetailPosRefund($input: RefundInput!) {
      refundCreate(input: $input) @idempotent(key: "${refundKey}") { refund { id } userErrors { field message } }
    }
  `, {
    input: {
      orderId: sale.shopifyOrderId,
      note: `Reembolso completo desde Cohen's Retail POS autorizado por ${authorization.managerName}.`,
      refundLineItems,
      transactions: parents.map((parent) => ({
        orderId: sale.shopifyOrderId,
        parentId: parent.id,
        gateway: parent.gateway,
        kind: "REFUND",
        amount: parent.amountSet.shopMoney.amount,
      })),
    },
  });
  if (result.refundCreate.userErrors.length || !result.refundCreate.refund) {
    throw new RetailPosError(result.refundCreate.userErrors.map((error) => error.message).join("; ") || "Shopify no registró el reembolso.", 409, "ORDER_REFUND_REJECTED");
  }
  return db.retailSale.update({
    where: { id: sale.id },
    data: { status: "REFUNDED", refundedAt: new Date(), refundedByName: authorization.managerName, shopifyRefundId: result.refundCreate.refund.id, errorMessage: null },
    include: { staff: { select: { name: true } } },
  });
}

export async function retryRetailSale(request: Request, saleId: string) {
  const session = await currentRetailSession(request);
  const sale = await db.retailSale.findFirst({ where: { id: saleId, shop: session!.shop } });
  if (!sale) throw new RetailPosError("No se encontró la venta pendiente.", 404, "SALE_NOT_FOUND");
  if (sale.status === "SYNCED") return retailReceipt(request, sale.id);
  return createRetailSale(request, { idempotencyKey: sale.idempotencyKey });
}

export async function retailReceipt(request: Request, saleId: string) {
  const session = await currentRetailSession(request);
  const sale = await db.retailSale.findFirst({
    where: { id: saleId, shop: session!.shop },
    include: { staff: { select: { name: true } } },
  });
  if (!sale) throw new RetailPosError("No se encontró la venta.", 404, "SALE_NOT_FOUND");
  return sale;
}

export async function markRetailReceiptPrinted(request: Request, saleId: string) {
  const sale = await retailReceipt(request, saleId);
  return db.retailSale.update({ where: { id: sale.id }, data: { lastPrintedAt: new Date(), printCount: { increment: 1 } } });
}

export function retailPosJsonError(error: unknown) {
  const known = error instanceof RetailPosError
    ? error
    : new RetailPosError(error instanceof Error ? error.message : "Error desconocido.", 500, "INTERNAL_ERROR");
  return Response.json({ ok: false, error: known.message, code: known.code }, { status: known.status });
}
