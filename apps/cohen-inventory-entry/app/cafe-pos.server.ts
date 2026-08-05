import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import db from "./db.server";
import { unauthenticated } from "./shopify.server";
import {
  assertCartInput,
  includedTaxCents,
  normalizeCafeName,
  parseMoneyToCents,
  parseShopifyMoneyToCents,
  safeIdempotencyKey,
  type CafePaymentMethod,
  type CafeReceiptItem,
} from "./cafe-pos-domain";

const POS_COOKIE = "cohens_cafe_pos";
const SESSION_HOURS = 12;
const loginAttempts = new Map<string, { failures: number; blockedUntil: number }>();

export class CafePosError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "CAFE_POS_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function configuredShop() {
  const shop = process.env.CAFE_SHOP_DOMAIN?.trim().toLowerCase();
  if (!shop || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    throw new CafePosError("La tienda de cafetería no está configurada.", 503, "CAFE_SHOP_NOT_CONFIGURED");
  }
  return shop;
}

export function assertCafePosEnabled() {
  if (process.env.CAFE_POS_ENABLED !== "true") {
    throw new CafePosError("La POS de cafetería no está habilitada.", 404, "CAFE_POS_DISABLED");
  }
  return configuredShop();
}

export function assertDedicatedCafeAdminShop(shop: string) {
  const expected = configuredShop();
  if (shop.toLowerCase() !== expected) {
    throw new CafePosError("Esta configuración solo está disponible en la tienda dedicada de cafetería.", 403, "WRONG_CAFE_SHOP");
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

export function sessionCookie(token: string) {
  const maxAge = SESSION_HOURS * 60 * 60;
  return `${POS_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return `${POS_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return;

  const allowedOrigins = new Set([new URL(request.url).origin]);
  const configuredUrl = process.env.SHOPIFY_APP_URL;
  if (configuredUrl) allowedOrigins.add(new URL(configuredUrl).origin);

  const forwardedHost = request.headers.get("X-Forwarded-Host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("X-Forwarded-Proto")?.split(",")[0]?.trim();
  if (forwardedHost && forwardedProto) allowedOrigins.add(`${forwardedProto}://${forwardedHost}`);

  if (!allowedOrigins.has(origin)) {
    throw new CafePosError("La solicitud no proviene de la POS autorizada.", 403, "ORIGIN_REJECTED");
  }
}

export async function createCafeStaff(shop: string, name: string, pin: string) {
  assertDedicatedCafeAdminShop(shop);
  const trimmedName = name.trim().replace(/\s+/g, " ");
  if (trimmedName.length < 2 || trimmedName.length > 80) {
    throw new CafePosError("El nombre debe contener entre 2 y 80 caracteres.");
  }
  if (!/^\d{4,8}$/.test(pin)) throw new CafePosError("El PIN debe contener entre 4 y 8 dígitos.");
  const salt = randomBytes(16).toString("hex");
  return db.cafeStaff.upsert({
    where: { shop_normalizedName: { shop, normalizedName: normalizeCafeName(trimmedName) } },
    create: {
      shop,
      name: trimmedName,
      normalizedName: normalizeCafeName(trimmedName),
      pinSalt: salt,
      pinHash: pinDigest(pin, salt).toString("hex"),
    },
    update: {
      name: trimmedName,
      pinSalt: salt,
      pinHash: pinDigest(pin, salt).toString("hex"),
      active: true,
    },
  });
}

export async function listCafeStaff(shop: string) {
  assertDedicatedCafeAdminShop(shop);
  return db.cafeStaff.findMany({ where: { shop }, orderBy: [{ active: "desc" }, { name: "asc" }] });
}

export async function setCafeStaffActive(shop: string, staffId: string, active: boolean) {
  assertDedicatedCafeAdminShop(shop);
  const staff = await db.cafeStaff.findFirst({ where: { id: staffId, shop } });
  if (!staff) throw new CafePosError("No se encontró el empleado.", 404);
  await db.$transaction([
    db.cafeStaff.update({ where: { id: staff.id }, data: { active } }),
    ...(!active
      ? [db.cafePosSession.updateMany({ where: { staffId: staff.id, revokedAt: null }, data: { revokedAt: new Date() } })]
      : []),
  ]);
}

function requestKey(request: Request) {
  const forwarded = request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  return `${configuredShop()}:${forwarded || "unknown"}`;
}

export async function loginCafeStaff(request: Request, pin: string) {
  const shop = assertCafePosEnabled();
  if (!/^\d{4,8}$/.test(pin)) throw new CafePosError("PIN incorrecto.", 401, "PIN_INVALID");
  const key = requestKey(request);
  const attempt = loginAttempts.get(key);
  if (attempt && attempt.blockedUntil > Date.now()) {
    throw new CafePosError("Demasiados intentos. Espera cinco minutos.", 429, "PIN_BLOCKED");
  }
  const staffMembers = await db.cafeStaff.findMany({ where: { shop, active: true } });
  const staff = staffMembers.find((candidate) => {
    const expected = Buffer.from(candidate.pinHash, "hex");
    const received = pinDigest(pin, candidate.pinSalt);
    return expected.length === received.length && timingSafeEqual(expected, received);
  });
  if (!staff) {
    const failures = (attempt?.failures ?? 0) + 1;
    loginAttempts.set(key, {
      failures: failures >= 5 ? 0 : failures,
      blockedUntil: failures >= 5 ? Date.now() + 5 * 60_000 : 0,
    });
    throw new CafePosError("PIN incorrecto.", 401, "PIN_INVALID");
  }
  loginAttempts.delete(key);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000);
  await db.cafePosSession.create({
    data: { shop, staffId: staff.id, tokenHash: tokenDigest(token), expiresAt },
  });
  return { token, staff: { id: staff.id, name: staff.name }, expiresAt };
}

export async function currentCafeSession(request: Request, required = true) {
  const shop = assertCafePosEnabled();
  const token = cookies(request)[POS_COOKIE];
  if (!token) {
    if (required) throw new CafePosError("Inicia sesión para usar la POS.", 401, "AUTH_REQUIRED");
    return null;
  }
  const session = await db.cafePosSession.findUnique({
    where: { tokenHash: tokenDigest(token) },
    include: { staff: true },
  });
  if (
    !session ||
    session.shop !== shop ||
    session.revokedAt ||
    session.expiresAt.getTime() <= Date.now() ||
    !session.staff.active
  ) {
    if (required) throw new CafePosError("La sesión expiró. Vuelve a ingresar tu PIN.", 401, "AUTH_EXPIRED");
    return null;
  }
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
    await db.cafePosSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return session;
}

export async function logoutCafeStaff(request: Request) {
  const token = cookies(request)[POS_COOKIE];
  if (token) {
    await db.cafePosSession.updateMany({
      where: { tokenHash: tokenDigest(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

type GraphqlAdmin = Awaited<ReturnType<typeof unauthenticated.admin>>["admin"];

async function adminContext() {
  const shop = assertCafePosEnabled();
  const { admin } = await unauthenticated.admin(shop);
  return { shop, admin };
}

async function graphql<T>(admin: GraphqlAdmin, query: string, variables: Record<string, unknown> = {}) {
  const response = await admin.graphql(query, { variables });
  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (payload.errors?.length) throw new CafePosError(payload.errors.map((error) => error.message).join("; "), 502, "SHOPIFY_GRAPHQL");
  if (!payload.data) throw new CafePosError("Shopify no devolvió datos.", 502, "SHOPIFY_EMPTY");
  return payload.data;
}

export async function cafeLocation(admin?: GraphqlAdmin) {
  const context = admin ? { admin } : await adminContext();
  const data = await graphql<{
    locations: { nodes: Array<{ id: string; name: string; isActive: boolean }> };
  }>(context.admin, `#graphql
    query CafePosLocations {
      locations(first: 25, includeInactive: false) { nodes { id name isActive } }
    }
  `);
  const expectedName = process.env.CAFE_LOCATION_NAME?.trim() || "Cohen's Cafe";
  const location = data.locations.nodes.find((item) => item.name === expectedName) ?? data.locations.nodes.find((item) => item.isActive);
  if (!location) throw new CafePosError("La tienda no tiene una ubicación activa.", 503, "LOCATION_MISSING");
  return location;
}

export async function getCafeCatalog() {
  const { admin } = await adminContext();
  const location = await cafeLocation(admin);
  const data = await graphql<{
    products: {
      nodes: Array<{
        id: string;
        title: string;
        handle: string;
        featuredMedia: { preview: { image: { url: string; altText: string | null } | null } | null } | null;
        variants: {
          nodes: Array<{
            id: string;
            title: string;
            sku: string | null;
            price: string;
            inventoryItem: {
              tracked: boolean;
              inventoryLevel: { quantities: Array<{ name: string; quantity: number }> } | null;
            };
          }>;
        };
      }>;
    };
  }>(admin, `#graphql
    query CafePosCatalog($locationId: ID!) {
      products(first: 100, query: "status:active tag:cohens-cafe", sortKey: TITLE) {
        nodes {
          id title handle
          featuredMedia { preview { image { url altText } } }
          variants(first: 100) {
            nodes {
              id title sku price
              inventoryItem {
                tracked
                inventoryLevel(locationId: $locationId) {
                  quantities(names: ["available"]) { name quantity }
                }
              }
            }
          }
        }
      }
    }
  `, { locationId: location.id });
  return {
    location,
    products: data.products.nodes.map((product) => ({
      id: product.id,
      title: product.title,
      handle: product.handle,
      imageUrl: product.featuredMedia?.preview?.image?.url ?? null,
      imageAlt: product.featuredMedia?.preview?.image?.altText ?? product.title,
      variants: product.variants.nodes.map((variant) => ({
        id: variant.id,
        title: variant.title,
        sku: variant.sku,
        priceCents: parseShopifyMoneyToCents(variant.price),
        tracked: variant.inventoryItem.tracked,
        available: variant.inventoryItem.inventoryLevel?.quantities.find((quantity) => quantity.name === "available")?.quantity ?? 0,
      })),
    })),
  };
}

export async function currentCafeShift(shop = configuredShop()) {
  return db.cafeRegisterShift.findFirst({
    where: { shop, status: "OPEN" },
    include: { staff: { select: { id: true, name: true } } },
    orderBy: { openedAt: "desc" },
  });
}

export async function openCafeShift(request: Request, openingCash: unknown) {
  const session = await currentCafeSession(request);
  const openingCashCents = parseMoneyToCents(openingCash, "El fondo inicial");
  const existing = await currentCafeShift(session!.shop);
  if (existing) throw new CafePosError(`Ya existe un turno abierto por ${existing.staff.name}.`, 409, "SHIFT_ALREADY_OPEN");
  return db.cafeRegisterShift.create({
    data: { shop: session!.shop, staffId: session!.staffId, openingCashCents },
    include: { staff: { select: { id: true, name: true } } },
  });
}

export async function closeCafeShift(
  request: Request,
  input: { closingCash: unknown; terminalCounted: unknown; notes?: unknown },
) {
  const session = await currentCafeSession(request);
  const shift = await currentCafeShift(session!.shop);
  if (!shift) throw new CafePosError("No hay un turno abierto.", 409, "SHIFT_NOT_OPEN");
  const totals = await db.cafeSale.groupBy({
    by: ["paymentMethod"],
    where: { shiftId: shift.id, status: { in: ["SYNCED", "PENDING_SYNC"] } },
    _sum: { totalCents: true },
  });
  const cashSales = totals.find((item) => item.paymentMethod === "CASH")?._sum.totalCents ?? 0;
  const terminalSales = totals.find((item) => item.paymentMethod === "EXTERNAL_CARD")?._sum.totalCents ?? 0;
  const closingCashCents = parseMoneyToCents(input.closingCash, "El efectivo contado");
  const terminalCountedCents = parseMoneyToCents(input.terminalCounted, "El total de terminal");
  const expectedCashCents = shift.openingCashCents + cashSales;
  return db.cafeRegisterShift.update({
    where: { id: shift.id },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      closingCashCents,
      expectedCashCents,
      cashVarianceCents: closingCashCents - expectedCashCents,
      terminalCountedCents,
      terminalExpectedCents: terminalSales,
      terminalVarianceCents: terminalCountedCents - terminalSales,
      notes: String(input.notes ?? "").trim().slice(0, 500) || null,
    },
    include: { staff: { select: { id: true, name: true } } },
  });
}

type ResolvedVariant = {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  product: { id: string; title: string; status: string };
  inventoryItem: {
    tracked: boolean;
    inventoryLevel: { quantities: Array<{ name: string; quantity: number }> } | null;
  };
};

async function resolveCart(admin: GraphqlAdmin, locationId: string, rawItems: unknown) {
  const items = assertCartInput(rawItems);
  const data = await graphql<{ nodes: Array<ResolvedVariant | null> }>(admin, `#graphql
    query CafePosVariants($ids: [ID!]!, $locationId: ID!) {
      nodes(ids: $ids) {
        ... on ProductVariant {
          id title sku price
          product { id title status }
          inventoryItem {
            tracked
            inventoryLevel(locationId: $locationId) {
              quantities(names: ["available"]) { name quantity }
            }
          }
        }
      }
    }
  `, { ids: items.map((item) => item.variantId), locationId });
  const byId = new Map(data.nodes.filter((node): node is ResolvedVariant => Boolean(node)).map((node) => [node.id, node]));
  return items.map((item) => {
    const variant = byId.get(item.variantId);
    if (!variant || variant.product.status !== "ACTIVE") throw new CafePosError("Un producto ya no está disponible.", 409, "PRODUCT_UNAVAILABLE");
    const available = variant.inventoryItem.inventoryLevel?.quantities.find((quantity) => quantity.name === "available")?.quantity ?? 0;
    if (variant.inventoryItem.tracked && available < item.quantity) {
      throw new CafePosError(`Existencia insuficiente para ${variant.product.title}. Disponible: ${available}.`, 409, "INSUFFICIENT_STOCK");
    }
    const unitPriceCents = parseShopifyMoneyToCents(variant.price);
    return {
      variantId: variant.id,
      productId: variant.product.id,
      title: variant.product.title,
      variantTitle: variant.title === "Default Title" ? null : variant.title,
      sku: variant.sku,
      quantity: item.quantity,
      unitPriceCents,
      totalCents: unitPriceCents * item.quantity,
    };
  });
}

function taxRateBasisPoints() {
  const value = Number(process.env.CAFE_TAX_RATE_BPS ?? "1600");
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new CafePosError("CAFE_TAX_RATE_BPS no es válido.", 503, "TAX_CONFIG_INVALID");
  }
  return value;
}

function paymentGateway(method: CafePaymentMethod) {
  return method === "CASH" ? "Cash" : "External card terminal";
}

async function findShopifyOrderBySale(admin: GraphqlAdmin, saleId: string) {
  const data = await graphql<{
    orders: { nodes: Array<{ id: string; name: string }> };
  }>(admin, `#graphql
    query CafePosOrderReconciliation($query: String!) {
      orders(first: 1, query: $query) { nodes { id name } }
    }
  `, { query: `tag:cafe-pos-${saleId}` });
  return data.orders.nodes[0] ?? null;
}

export async function createCafeSale(request: Request, raw: Record<string, unknown>) {
  const session = await currentCafeSession(request);
  const method = String(raw.paymentMethod ?? "") as CafePaymentMethod;
  if (method !== "CASH" && method !== "EXTERNAL_CARD") {
    throw new CafePosError("Selecciona efectivo o terminal externa.");
  }
  const idempotencyKey = safeIdempotencyKey(raw.idempotencyKey);
  let sale = await db.cafeSale.findUnique({
    where: { shop_idempotencyKey: { shop: session!.shop, idempotencyKey } },
    include: { staff: { select: { name: true } } },
  });
  const shift = sale
    ? await db.cafeRegisterShift.findUnique({ where: { id: sale.shiftId }, include: { staff: { select: { id: true, name: true } } } })
    : await currentCafeShift(session!.shop);
  if (!shift) throw new CafePosError("Abre un turno antes de cobrar.", 409, "SHIFT_NOT_OPEN");
  if (sale?.status === "SYNCED") return sale;
  if (sale && sale.paymentMethod !== method) {
    throw new CafePosError("La llave de venta ya pertenece a otra operación.", 409, "IDEMPOTENCY_CONFLICT");
  }
  const { admin } = await adminContext();
  const location = await cafeLocation(admin);
  const resolved = await resolveCart(admin, location.id, raw.items);
  const totalCents = resolved.reduce((sum, item) => sum + item.totalCents, 0);
  const rateBasisPoints = taxRateBasisPoints();
  const taxCents = includedTaxCents(totalCents, rateBasisPoints);
  const receiptItems: Array<CafeReceiptItem & { variantId: string }> = resolved.map((item) => ({
    variantId: item.variantId,
    title: item.title,
    variantTitle: item.variantTitle,
    sku: item.sku,
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
    totalCents: item.totalCents,
  }));
  if (!sale) {
    sale = await db.cafeSale.create({
      data: {
        shop: session!.shop,
        idempotencyKey,
        staffId: session!.staffId,
        shiftId: shift.id,
        paymentMethod: method,
        externalReference: String(raw.externalReference ?? "").trim().slice(0, 100) || null,
        subtotalCents: totalCents - taxCents,
        taxCents,
        totalCents,
        items: receiptItems,
      },
      include: { staff: { select: { name: true } } },
    });
  }

  try {
    const reconciled = await findShopifyOrderBySale(admin, sale.id);
    if (reconciled) {
      return db.cafeSale.update({
        where: { id: sale.id },
        data: { status: "SYNCED", shopifyOrderId: reconciled.id, shopifyOrderName: reconciled.name, syncedAt: new Date(), errorMessage: null },
        include: { staff: { select: { name: true } } },
      });
    }
    const currencyCode = "MXN";
    const taxRate = rateBasisPoints / 10_000;
    const result = await graphql<{
      orderCreate: {
        order: { id: string; name: string } | null;
        userErrors: Array<{ field?: string[]; message: string }>;
      };
    }>(admin, `#graphql
      mutation CafePosOrder($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
        orderCreate(order: $order, options: $options) {
          order { id name }
          userErrors { field message }
        }
      }
    `, {
      order: {
        currency: currencyCode,
        taxesIncluded: true,
        lineItems: resolved.map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
          taxLines: rateBasisPoints
            ? [{
                title: "IVA",
                rate: taxRate,
                priceSet: { shopMoney: { amount: (includedTaxCents(item.totalCents, rateBasisPoints) / 100).toFixed(2), currencyCode } },
              }]
            : [],
        })),
        transactions: [{
          kind: "SALE",
          status: "SUCCESS",
          gateway: paymentGateway(method),
          locationId: location.id,
          amountSet: { shopMoney: { amount: (totalCents / 100).toFixed(2), currencyCode } },
        }],
        fulfillmentStatus: "FULFILLED",
        tags: ["cohens-cafe", "cafe-pos", `cafe-pos-${sale.id}`],
        note: `Venta de POS web. Empleado: ${sale.staff.name}. Turno: ${shift.id}.`,
        customAttributes: [
          { key: "cafe_pos_sale_id", value: sale.id },
          { key: "cafe_pos_staff", value: sale.staff.name },
          { key: "cafe_pos_payment", value: paymentGateway(method) },
        ],
        processedAt: new Date().toISOString(),
      },
      options: { inventoryBehaviour: "DECREMENT_OBEYING_POLICY", sendReceipt: false, sendFulfillmentReceipt: false },
    });
    if (result.orderCreate.userErrors.length || !result.orderCreate.order) {
      throw new CafePosError(result.orderCreate.userErrors.map((error) => error.message).join("; ") || "Shopify no creó el pedido.", 502, "ORDER_REJECTED");
    }
    return db.cafeSale.update({
      where: { id: sale.id },
      data: {
        status: "SYNCED",
        shopifyOrderId: result.orderCreate.order.id,
        shopifyOrderName: result.orderCreate.order.name,
        syncedAt: new Date(),
        errorMessage: null,
      },
      include: { staff: { select: { name: true } } },
    });
  } catch (error) {
    await db.cafeSale.update({
      where: { id: sale.id },
      data: { status: "PENDING_SYNC", errorMessage: error instanceof Error ? error.message.slice(0, 1000) : "Error desconocido" },
    });
    throw new CafePosError(
      `La venta quedó pendiente de sincronización con folio ${sale.id}. No vuelvas a cobrar; usa Reintentar.`,
      503,
      "ORDER_PENDING_SYNC",
    );
  }
}

export async function recentCafeSales(request: Request, limit = 30) {
  const session = await currentCafeSession(request);
  return db.cafeSale.findMany({
    where: { shop: session!.shop },
    include: { staff: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: Math.max(1, Math.min(limit, 100)),
  });
}

export async function retryCafeSale(request: Request, saleId: string) {
  const session = await currentCafeSession(request);
  const sale = await db.cafeSale.findFirst({ where: { id: saleId, shop: session!.shop } });
  if (!sale) throw new CafePosError("No se encontró la venta pendiente.", 404, "SALE_NOT_FOUND");
  if (sale.status === "SYNCED") return cafeReceipt(request, sale.id);
  const items = sale.items as unknown as Array<CafeReceiptItem & { variantId?: string }>;
  if (items.some((item) => !item.variantId)) {
    throw new CafePosError("La venta pendiente no contiene datos suficientes para reintentarse automáticamente.", 409, "SALE_RETRY_UNAVAILABLE");
  }
  return createCafeSale(request, {
    idempotencyKey: sale.idempotencyKey,
    paymentMethod: sale.paymentMethod,
    externalReference: sale.externalReference,
    items: items.map((item) => ({ variantId: item.variantId, quantity: item.quantity })),
  });
}

export async function cafeReceipt(request: Request, saleId: string) {
  const session = await currentCafeSession(request);
  const sale = await db.cafeSale.findFirst({
    where: { id: saleId, shop: session!.shop },
    include: { staff: { select: { name: true } } },
  });
  if (!sale) throw new CafePosError("No se encontró la venta.", 404, "SALE_NOT_FOUND");
  return sale;
}

export async function markCafeReceiptPrinted(request: Request, saleId: string) {
  const sale = await cafeReceipt(request, saleId);
  return db.cafeSale.update({
    where: { id: sale.id },
    data: { lastPrintedAt: new Date(), printCount: { increment: 1 } },
  });
}

export function cafePosJsonError(error: unknown) {
  const known = error instanceof CafePosError ? error : new CafePosError(error instanceof Error ? error.message : "Error desconocido.", 500, "INTERNAL_ERROR");
  return Response.json({ ok: false, error: known.message, code: known.code }, { status: known.status });
}
