import { createHash, createHmac, randomUUID } from "node:crypto";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import db from "./db.server";
import {
  cashbackBasisPointsForTier,
  calculateNekudotPurchase,
  calculateRestoredRedemptionCents,
  NEKUDOT_PROGRAM_KEY,
  nekudotCredentialLastFour,
  normalizeBrokerCode,
  normalizeNekudotCardTier,
  normalizeNekudotCredential,
  parseNekudotMoney,
  safeNekudotOperationKey,
} from "./nekudot-domain";

export class NekudotError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = "NEKUDOT_ERROR",
  ) {
    super(message);
  }
}

type ShopifyCustomer = {
  id: string;
  legacyResourceId: string;
  displayName: string;
  defaultEmailAddress: { emailAddress: string } | null;
};

type ShopifyCustomerSummary = {
  id: string;
  displayName: string;
  defaultEmailAddress: { emailAddress: string } | null;
  defaultPhoneNumber: { phoneNumber: string } | null;
  numberOfOrders: string;
  amountSpent: { amount: string; currencyCode: string };
};

type ShopifyCustomerConnection = {
  nodes: ShopifyCustomerSummary[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};

async function graphql<T>(admin: AdminApiContext, query: string, variables: Record<string, unknown> = {}) {
  const response = await admin.graphql(query, { variables });
  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
  if (payload.errors?.length) {
    throw new NekudotError(
      payload.errors.map((error) => error.message ?? "Error GraphQL").join("; "),
      502,
      "SHOPIFY_GRAPHQL",
    );
  }
  if (!payload.data) throw new NekudotError("Shopify no devolvió datos.", 502, "SHOPIFY_EMPTY");
  return payload.data;
}

function customerSummary(customer: ShopifyCustomerSummary) {
  return {
    id: customer.id,
    displayName: customer.displayName || "Cliente sin nombre",
    email: customer.defaultEmailAddress?.emailAddress?.trim() || null,
    phone: customer.defaultPhoneNumber?.phoneNumber?.trim() || null,
    numberOfOrders: Number(customer.numberOfOrders) || 0,
    amountSpent: customer.amountSpent.amount,
    currencyCode: customer.amountSpent.currencyCode,
  };
}

export async function searchShopifyCustomers(admin: AdminApiContext, search: string) {
  const query = search.trim().slice(0, 100);
  if (query.length < 2) return [];
  const data = await graphql<{ customers: { nodes: ShopifyCustomerSummary[] } }>(admin, `#graphql
    query NekudotCustomerSearch($query: String!) {
      customers(first: 20, query: $query, sortKey: UPDATED_AT, reverse: true) {
        nodes {
          id displayName
          defaultEmailAddress { emailAddress }
          defaultPhoneNumber { phoneNumber }
          numberOfOrders
          amountSpent { amount currencyCode }
        }
      }
    }
  `, { query });
  return data.customers.nodes.map(customerSummary);
}

export async function listShopifyCustomers(admin: AdminApiContext) {
  const customers: ShopifyCustomerSummary[] = [];
  let after: string | null = null;
  do {
    const data: { customers: ShopifyCustomerConnection } = await graphql(admin, `#graphql
      query NekudotCustomerList($after: String) {
        customers(first: 250, after: $after, sortKey: UPDATED_AT, reverse: true) {
          nodes {
            id displayName
            defaultEmailAddress { emailAddress }
            defaultPhoneNumber { phoneNumber }
            numberOfOrders
            amountSpent { amount currencyCode }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { after });
    customers.push(...data.customers.nodes);
    after = data.customers.pageInfo.hasNextPage
      ? data.customers.pageInfo.endCursor
      : null;
  } while (after);
  return customers.map(customerSummary);
}

function secret() {
  const value = process.env.NEKUDOT_TOKEN_SECRET?.trim()
    || process.env.CASHBACK_TOKEN_SECRET?.trim()
    || process.env.SHOPIFY_API_SECRET?.trim();
  if (!value) throw new NekudotError("Falta configurar NEKUDOT_TOKEN_SECRET.", 503, "TOKEN_SECRET_MISSING");
  return value;
}

function tokenHash(rawToken: unknown) {
  return createHmac("sha256", secret())
    .update(`${NEKUDOT_PROGRAM_KEY}:${normalizeNekudotCredential(rawToken)}`)
    .digest("hex");
}

async function resolveCustomer(admin: AdminApiContext, customerId: string) {
  if (!/^gid:\/\/shopify\/Customer\/\d+$/.test(customerId)) {
    throw new NekudotError("El cliente de Shopify no es válido.");
  }
  const data = await graphql<{ customer: ShopifyCustomer | null }>(admin, `#graphql
    query NekudotCustomer($id: ID!) {
      customer(id: $id) {
        id legacyResourceId displayName
        defaultEmailAddress { emailAddress }
      }
    }
  `, { id: customerId });
  if (!data.customer) throw new NekudotError("Shopify no encontró al cliente.", 404);
  return data.customer;
}

export async function createNekudotBroker(input: {
  code: unknown;
  displayName: unknown;
  email?: unknown;
  phone?: unknown;
}) {
  const code = normalizeBrokerCode(input.code);
  const displayName = String(input.displayName ?? "").trim().replace(/\s+/g, " ").slice(0, 100);
  if (displayName.length < 2) throw new NekudotError("Escribe el nombre del broker.");
  const phoneDigits = String(input.phone ?? "").replace(/\D/g, "");
  const phone = phoneDigits ? (phoneDigits.length === 10 ? `+52${phoneDigits}` : `+${phoneDigits}`) : null;
  if (phone && !/^\+[1-9]\d{9,14}$/.test(phone)) throw new NekudotError("Escribe un teléfono válido para el IB.");
  return db.nekudotBroker.upsert({
    where: { programKey_code: { programKey: NEKUDOT_PROGRAM_KEY, code } },
    create: {
      programKey: NEKUDOT_PROGRAM_KEY,
      code,
      displayName,
      email: String(input.email ?? "").trim().slice(0, 150) || null,
      phone,
    },
    update: {
      displayName,
      email: String(input.email ?? "").trim().slice(0, 150) || null,
      phone,
      active: true,
    },
  });
}

export function listNekudotBrokers() {
  return db.nekudotBroker.findMany({
    where: { programKey: NEKUDOT_PROGRAM_KEY, active: true },
    include: { _count: { select: { clients: true } } },
    orderBy: { displayName: "asc" },
  });
}

export async function bindNekudotCredential(input: {
  admin: AdminApiContext;
  shop: string;
  customerId: string;
  rawToken: unknown;
  kind?: unknown;
  label?: unknown;
  brokerId?: unknown;
  cardTier?: unknown;
}) {
  const customer = await resolveCustomer(input.admin, input.customerId);
  const digest = tokenHash(input.rawToken);
  const lastFour = nekudotCredentialLastFour(input.rawToken);
  const kind = String(input.kind ?? "RFID_OR_QR");
  const cardTier = normalizeNekudotCardTier(input.cardTier);
  if (!new Set(["RFID", "QR", "RFID_OR_QR"]).has(kind)) throw new NekudotError("Tipo de credencial no válido.");
  const brokerId = String(input.brokerId ?? "").trim() || null;
  if (brokerId && cardTier !== "BLUE") {
    throw new NekudotError("Los IBs sólo pueden vincularse a tarjetas Blue.");
  }
  if (brokerId) {
    const broker = await db.nekudotBroker.findFirst({ where: { id: brokerId, programKey: NEKUDOT_PROGRAM_KEY, active: true } });
    if (!broker) throw new NekudotError("El broker seleccionado no está activo.", 404);
  }

  return db.$transaction(async (transaction) => {
    const [credential, identity] = await Promise.all([
      transaction.nekudotCredential.findUnique({
        where: { programKey_tokenHash: { programKey: NEKUDOT_PROGRAM_KEY, tokenHash: digest } },
      }),
      transaction.nekudotCustomerIdentity.findUnique({
        where: { shop_shopifyCustomerId: { shop: input.shop, shopifyCustomerId: customer.id } },
      }),
    ]);
    if (credential && identity && credential.memberId !== identity.memberId) {
      throw new NekudotError("La tarjeta y el cliente pertenecen a miembros distintos.", 409, "MEMBER_CONFLICT");
    }
    let memberId = credential?.memberId ?? identity?.memberId;
    if (!memberId) {
      const member = await transaction.nekudotMember.create({
        data: {
          programKey: NEKUDOT_PROGRAM_KEY,
          displayName: customer.displayName || "Cliente sin nombre",
          email: customer.defaultEmailAddress?.emailAddress ?? null,
          brokerId,
          cardTier,
        },
      });
      memberId = member.id;
    }
    const otherIdentity = await transaction.nekudotCustomerIdentity.findUnique({
      where: { memberId_shop: { memberId, shop: input.shop } },
    });
    if (otherIdentity && otherIdentity.shopifyCustomerId !== customer.id) {
      throw new NekudotError("Este miembro ya está vinculado a otro cliente en esta tienda.", 409, "SHOP_IDENTITY_CONFLICT");
    }
    await transaction.nekudotMember.update({
      where: { id: memberId },
      data: {
        displayName: customer.displayName || "Cliente sin nombre",
        email: customer.defaultEmailAddress?.emailAddress ?? null,
        active: true,
        cardTier,
        brokerId,
      },
    });
    await transaction.nekudotCustomerIdentity.upsert({
      where: { shop_shopifyCustomerId: { shop: input.shop, shopifyCustomerId: customer.id } },
      create: {
        programKey: NEKUDOT_PROGRAM_KEY,
        memberId,
        shop: input.shop,
        shopifyCustomerId: customer.id,
        shopifyLegacyCustomerId: String(customer.legacyResourceId),
        displayName: customer.displayName || "Cliente sin nombre",
        email: customer.defaultEmailAddress?.emailAddress ?? null,
      },
      update: {
        memberId,
        shopifyLegacyCustomerId: String(customer.legacyResourceId),
        displayName: customer.displayName || "Cliente sin nombre",
        email: customer.defaultEmailAddress?.emailAddress ?? null,
      },
    });
    await transaction.nekudotCredential.upsert({
      where: { programKey_tokenHash: { programKey: NEKUDOT_PROGRAM_KEY, tokenHash: digest } },
      create: {
        programKey: NEKUDOT_PROGRAM_KEY,
        memberId,
        tokenHash: digest,
        lastFour,
        kind,
        label: String(input.label ?? "").trim().slice(0, 80) || null,
      },
      update: {
        memberId,
        kind,
        label: String(input.label ?? "").trim().slice(0, 80) || null,
        active: true,
        revokedAt: null,
        revokedReason: null,
        revokedByShop: null,
      },
    });
    return transaction.nekudotMember.findUniqueOrThrow({
      where: { id: memberId },
      include: { broker: true, credentials: true, identities: true },
    });
  });
}

export async function replaceNekudotCredential(input: {
  admin: AdminApiContext;
  shop: string;
  customerId: string;
  rawToken: unknown;
  kind?: unknown;
  label?: unknown;
  identityVerified?: unknown;
  cardTier?: unknown;
}) {
  if (String(input.identityVerified ?? "") !== "yes") {
    throw new NekudotError(
      "Confirma que el personal verificó la identificación del cliente.",
      400,
      "IDENTITY_VERIFICATION_REQUIRED",
    );
  }
  const customer = await resolveCustomer(input.admin, input.customerId);
  const digest = tokenHash(input.rawToken);
  const lastFour = nekudotCredentialLastFour(input.rawToken);
  const kind = String(input.kind ?? "RFID_OR_QR");
  const cardTier = normalizeNekudotCardTier(input.cardTier);
  if (!new Set(["RFID", "QR", "RFID_OR_QR"]).has(kind)) {
    throw new NekudotError("Tipo de credencial no válido.");
  }
  const label = String(input.label ?? "").trim().slice(0, 80) || "Tarjeta de reemplazo";

  return db.$transaction(async (transaction) => {
    const identity = await transaction.nekudotCustomerIdentity.findUnique({
      where: { shop_shopifyCustomerId: { shop: input.shop, shopifyCustomerId: customer.id } },
      include: { member: true },
    });
    if (!identity?.member.active) {
      throw new NekudotError(
        "Este cliente todavía no tiene una membresía Nekudot activa.",
        404,
        "MEMBER_NOT_FOUND",
      );
    }
    const incoming = await transaction.nekudotCredential.findUnique({
      where: { programKey_tokenHash: { programKey: NEKUDOT_PROGRAM_KEY, tokenHash: digest } },
    });
    if (incoming?.active) {
      throw new NekudotError(
        incoming.memberId === identity.memberId
          ? "La nueva tarjeta ya está activa en este perfil."
          : "La nueva tarjeta ya pertenece a otro miembro.",
        409,
        "CREDENTIAL_ALREADY_ACTIVE",
      );
    }
    if (incoming && incoming.memberId !== identity.memberId) {
      throw new NekudotError(
        "Una tarjeta revocada de otro miembro no puede reutilizarse.",
        409,
        "CREDENTIAL_OWNERSHIP_CONFLICT",
      );
    }

    const activeCredentials = await transaction.nekudotCredential.findMany({
      where: { memberId: identity.memberId, active: true },
      select: { id: true, lastFour: true },
    });
    const revokedAt = new Date();
    await transaction.nekudotCredential.updateMany({
      where: { memberId: identity.memberId, active: true },
      data: {
        active: false,
        revokedAt,
        revokedReason: "LOST_OR_REPLACED",
        revokedByShop: input.shop,
      },
    });
    const replacement = await transaction.nekudotCredential.upsert({
      where: { programKey_tokenHash: { programKey: NEKUDOT_PROGRAM_KEY, tokenHash: digest } },
      create: {
        programKey: NEKUDOT_PROGRAM_KEY,
        memberId: identity.memberId,
        tokenHash: digest,
        lastFour,
        kind,
        label,
      },
      update: {
        memberId: identity.memberId,
        lastFour,
        kind,
        label,
        active: true,
        revokedAt: null,
        revokedReason: null,
        revokedByShop: null,
      },
    });
    await transaction.nekudotMember.update({
      where: { id: identity.memberId },
      data: { cardTier },
    });
    await transaction.nekudotLedgerEntry.create({
      data: {
        programKey: NEKUDOT_PROGRAM_KEY,
        memberId: identity.memberId,
        walletType: "CLIENT",
        type: "CREDENTIAL_REPLACED",
        amountCents: 0,
        balanceAfterCents: identity.member.balanceCents,
        currencyCode: identity.member.currencyCode,
        shop: input.shop,
        source: "ADMIN",
        sourceId: replacement.id,
        idempotencyKey: `credential-replacement:${randomUUID()}`,
        description: `Tarjeta reemplazada para ${customer.displayName || "cliente"}; saldo conservado`,
        metadata: {
          identityVerified: true,
          revokedCredentials: activeCredentials,
          replacementLastFour: replacement.lastFour,
          cardTier,
        },
      },
    });
    return transaction.nekudotMember.findUniqueOrThrow({
      where: { id: identity.memberId },
      include: { broker: true, credentials: { where: { active: true } }, identities: true },
    });
  });
}

export async function expireNekudotReservations() {
  const expired = await db.nekudotRedemption.findMany({
    where: { programKey: NEKUDOT_PROGRAM_KEY, status: "RESERVED", expiresAt: { lt: new Date() } },
    take: 100,
  });
  for (const reservation of expired) {
    await db.$transaction(async (transaction) => {
      const changed = await transaction.nekudotRedemption.updateMany({
        where: { id: reservation.id, status: "RESERVED" },
        data: { status: "EXPIRED", cancelledAt: new Date() },
      });
      if (changed.count) {
        await transaction.nekudotMember.update({
          where: { id: reservation.memberId },
          data: { reservedCents: { decrement: reservation.amountCents } },
        });
      }
    });
  }
}

export async function lookupNekudotMember(shop: string, rawToken: unknown) {
  await expireNekudotReservations();
  const credential = await db.nekudotCredential.findUnique({
    where: { programKey_tokenHash: { programKey: NEKUDOT_PROGRAM_KEY, tokenHash: tokenHash(rawToken) } },
    include: {
      member: {
        include: {
          broker: true,
          credentials: { where: { active: true } },
          identities: true,
        },
      },
    },
  });
  if (!credential?.active || !credential.member.active) {
    throw new NekudotError("No encontramos una membresía activa para ese ID.", 404, "CREDENTIAL_NOT_FOUND");
  }
  const identity = credential.member.identities.find((item) => item.shop === shop) ?? null;
  return {
    ...credential.member,
    availableCents: credential.member.balanceCents - credential.member.reservedCents,
    currentShopIdentity: identity,
  };
}

export async function reserveNekudot(input: {
  shop: string;
  rawToken: unknown;
  amount: unknown;
  cartTotalCents?: unknown;
  cartReference?: unknown;
  idempotencyKey?: unknown;
}) {
  const member = await lookupNekudotMember(input.shop, input.rawToken);
  const amountCents = parseNekudotMoney(input.amount);
  const cartTotalCents = Number(input.cartTotalCents ?? 0);
  if (Number.isInteger(cartTotalCents) && cartTotalCents > 0 && amountCents > cartTotalCents) {
    throw new NekudotError("El canje no puede superar el total del carrito.");
  }
  if (amountCents > member.availableCents) {
    throw new NekudotError("El saldo disponible no alcanza para ese canje.", 409, "INSUFFICIENT_BALANCE");
  }
  const rawKey = String(input.idempotencyKey ?? "").trim();
  const idempotencyKey = rawKey ? safeNekudotOperationKey(rawKey) : `redemption:${randomUUID()}`;
  return db.$transaction(async (transaction) => {
    const existing = await transaction.nekudotRedemption.findUnique({
      where: { programKey_idempotencyKey: { programKey: NEKUDOT_PROGRAM_KEY, idempotencyKey } },
    });
    if (existing) {
      if (
        existing.memberId !== member.id
        || existing.shop !== input.shop
        || existing.amountCents !== amountCents
      ) {
        throw new NekudotError(
          "La llave de canje ya pertenece a otra operación.",
          409,
          "IDEMPOTENCY_CONFLICT",
        );
      }
      return existing;
    }
    const fresh = await transaction.nekudotMember.findUniqueOrThrow({ where: { id: member.id } });
    if (fresh.balanceCents - fresh.reservedCents < amountCents) {
      throw new NekudotError("El saldo cambió y ya no alcanza para ese canje.", 409, "INSUFFICIENT_BALANCE");
    }
    const reservation = await transaction.nekudotRedemption.create({
      data: {
        programKey: NEKUDOT_PROGRAM_KEY,
        memberId: member.id,
        shop: input.shop,
        amountCents,
        idempotencyKey,
        cartReference: String(input.cartReference ?? "").trim().slice(0, 100) || null,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
    await transaction.nekudotMember.update({ where: { id: member.id }, data: { reservedCents: { increment: amountCents } } });
    return reservation;
  });
}

export async function cancelNekudotReservation(shop: string, reservationId: string) {
  return db.$transaction(async (transaction) => {
    const reservation = await transaction.nekudotRedemption.findFirst({ where: { id: reservationId, shop } });
    if (!reservation || reservation.status !== "RESERVED") return reservation;
    await transaction.nekudotMember.update({ where: { id: reservation.memberId }, data: { reservedCents: { decrement: reservation.amountCents } } });
    return transaction.nekudotRedemption.update({ where: { id: reservation.id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  });
}

/** Keeps an already-recorded café sale retryable without persisting the raw card ID. */
export async function renewNekudotReservation(shop: string, reservationId: string) {
  return db.$transaction(async (transaction) => {
    const reservation = await transaction.nekudotRedemption.findFirst({
      where: { id: reservationId, shop },
    });
    if (!reservation) throw new NekudotError("No se encontró la reserva de Nekudot.", 404);
    if (reservation.status === "RESERVED") {
      return transaction.nekudotRedemption.update({
        where: { id: reservation.id },
        data: { expiresAt: new Date(Date.now() + 30 * 60_000) },
      });
    }
    if (reservation.status !== "EXPIRED") {
      throw new NekudotError("La reserva de Nekudot ya no se puede reutilizar.", 409, "RESERVATION_CLOSED");
    }
    const member = await transaction.nekudotMember.findUniqueOrThrow({ where: { id: reservation.memberId } });
    if (member.balanceCents - member.reservedCents < reservation.amountCents) {
      throw new NekudotError("El saldo ya no alcanza para reintentar esta venta.", 409, "INSUFFICIENT_BALANCE");
    }
    await transaction.nekudotMember.update({
      where: { id: member.id },
      data: { reservedCents: { increment: reservation.amountCents } },
    });
    return transaction.nekudotRedemption.update({
      where: { id: reservation.id },
      data: {
        status: "RESERVED",
        cancelledAt: null,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
  });
}

type OrderInput = {
  shop: string;
  shopifyOrderId: string;
  orderName: string;
  customerId: string | null;
  currencyCode: string;
  eligibleFinancialStatus: boolean;
  cancelled: boolean;
  orderUpdatedAt: Date;
  purchaseCents: number;
  customAttributes: Array<{ key: string; value: string }>;
};

function attribute(attributes: OrderInput["customAttributes"], key: string) {
  return attributes.find((item) => item.key === key)?.value?.trim() || null;
}

export async function reconcileNekudotOrder(input: OrderInput) {
  const memberIdAttribute = attribute(input.customAttributes, "nekudot_member_id");
  const redemptionId = attribute(input.customAttributes, "nekudot_redemption_id");
  const [identity, attributedMember, reservation, existingAccrual] = await Promise.all([
    input.customerId
      ? db.nekudotCustomerIdentity.findUnique({ where: { shop_shopifyCustomerId: { shop: input.shop, shopifyCustomerId: input.customerId } } })
      : null,
    memberIdAttribute
      ? db.nekudotMember.findFirst({ where: { id: memberIdAttribute, programKey: NEKUDOT_PROGRAM_KEY } })
      : null,
    redemptionId
      ? db.nekudotRedemption.findFirst({ where: { id: redemptionId, shop: input.shop }, include: { member: true } })
      : null,
    db.nekudotOrderAccrual.findUnique({ where: { shop_shopifyOrderId: { shop: input.shop, shopifyOrderId: input.shopifyOrderId } } }),
  ]);
  const targetMemberId = reservation?.memberId ?? attributedMember?.id ?? identity?.memberId ?? existingAccrual?.memberId ?? null;
  const member = targetMemberId
    ? await db.nekudotMember.findUnique({ where: { id: targetMemberId }, include: { broker: true } })
    : null;
  const newOrderMember = member?.active ? member : existingAccrual ? member : null;
  const brokerId = existingAccrual?.brokerId ?? newOrderMember?.brokerId ?? null;
  const purchaseCents = input.eligibleFinancialStatus && !input.cancelled ? Math.max(0, input.purchaseCents) : 0;
  const originalPurchaseCents = Math.max(
    existingAccrual?.originalPurchaseCents ?? 0,
    purchaseCents,
  );
  const keepsOriginalRate = Boolean(existingAccrual && existingAccrual.memberId === newOrderMember?.id);
  const cashbackTier = keepsOriginalRate
    ? normalizeNekudotCardTier(existingAccrual!.cashbackTier)
    : normalizeNekudotCardTier(newOrderMember?.cardTier ?? "SILVER");
  const cashbackBasisPoints = keepsOriginalRate
    ? existingAccrual!.cashbackBasisPoints
    : cashbackBasisPointsForTier(cashbackTier);
  const target = calculateNekudotPurchase(purchaseCents, Boolean(brokerId), cashbackBasisPoints, cashbackTier);
  const hash = createHash("sha256").update(JSON.stringify({
    order: input.shopifyOrderId,
    updated: input.orderUpdatedAt.toISOString(),
    memberId: newOrderMember?.id ?? null,
    brokerId,
    cashbackTier,
    cashbackBasisPoints,
    target,
    originalPurchaseCents,
    cancelled: input.cancelled,
    redemptionId,
  })).digest("hex");

  return db.$transaction(async (transaction) => {
    const postMember = async (memberId: string, delta: number, suffix: string, description: string) => {
      if (!delta) return;
      const updated = await transaction.nekudotMember.update({
        where: { id: memberId },
        data: { balanceCents: { increment: delta }, lifetimeEarnedCents: { increment: delta } },
      });
      await transaction.nekudotLedgerEntry.create({ data: {
        programKey: NEKUDOT_PROGRAM_KEY, memberId, walletType: "CLIENT", type: delta > 0 ? "EARN" : "REVERSAL",
        amountCents: delta, balanceAfterCents: updated.balanceCents, currencyCode: input.currencyCode,
        shop: input.shop, source: "SHOPIFY_ORDER", sourceId: input.shopifyOrderId,
        idempotencyKey: `order:${hash}:client:${suffix}`, description,
      } });
    };
    const postBroker = async (targetBrokerId: string, delta: number, suffix: string, description: string) => {
      if (!delta) return;
      const updated = await transaction.nekudotBroker.update({
        where: { id: targetBrokerId },
        data: { commissionBalanceCents: { increment: delta }, lifetimeCommissionCents: { increment: delta } },
      });
      await transaction.nekudotLedgerEntry.create({ data: {
        programKey: NEKUDOT_PROGRAM_KEY, brokerId: targetBrokerId, walletType: "BROKER", type: delta > 0 ? "COMMISSION" : "REVERSAL",
        amountCents: delta, balanceAfterCents: updated.commissionBalanceCents, currencyCode: input.currencyCode,
        shop: input.shop, source: "SHOPIFY_ORDER", sourceId: input.shopifyOrderId,
        idempotencyKey: `order:${hash}:broker:${suffix}`, description,
      } });
    };

    if (reservation) {
      if (input.cancelled && ["RESERVED", "EXPIRED"].includes(reservation.status)) {
        if (reservation.status === "RESERVED") {
          await transaction.nekudotMember.update({ where: { id: reservation.memberId }, data: { reservedCents: { decrement: reservation.amountCents } } });
        }
        await transaction.nekudotRedemption.update({ where: { id: reservation.id }, data: { status: "CANCELLED", cancelledAt: new Date(), shopifyOrderId: input.shopifyOrderId } });
      } else if (input.cancelled && ["APPLIED", "RESTORED"].includes(reservation.status)) {
        const restoreDelta = reservation.amountCents - reservation.restoredCents;
        if (restoreDelta) {
          const restored = await transaction.nekudotMember.update({
            where: { id: reservation.memberId },
            data: {
              balanceCents: { increment: restoreDelta },
              lifetimeRedeemedCents: { increment: -restoreDelta },
            },
          });
          await transaction.nekudotLedgerEntry.create({ data: {
            programKey: NEKUDOT_PROGRAM_KEY, memberId: reservation.memberId, walletType: "CLIENT", type: "REDEMPTION_REVERSAL",
            amountCents: restoreDelta, balanceAfterCents: restored.balanceCents, currencyCode: input.currencyCode,
            shop: input.shop, source: "SHOPIFY_ORDER", sourceId: input.shopifyOrderId,
            idempotencyKey: `redemption:${reservation.id}:cancelled`, description: `Restitución de Nekudot por cancelación de ${input.orderName}`,
          } });
        }
        await transaction.nekudotRedemption.update({
          where: { id: reservation.id },
          data: { status: "CANCELLED", restoredCents: reservation.amountCents, cancelledAt: new Date() },
        });
      } else if (input.eligibleFinancialStatus && ["RESERVED", "EXPIRED"].includes(reservation.status)) {
        const charged = await transaction.nekudotMember.update({ where: { id: reservation.memberId }, data: {
          ...(reservation.status === "RESERVED" ? { reservedCents: { decrement: reservation.amountCents } } : {}),
          balanceCents: { decrement: reservation.amountCents },
          lifetimeRedeemedCents: { increment: reservation.amountCents },
        } });
        await transaction.nekudotLedgerEntry.create({ data: {
          programKey: NEKUDOT_PROGRAM_KEY, memberId: reservation.memberId, walletType: "CLIENT", type: reservation.status === "EXPIRED" ? "LATE_REDEEM" : "REDEEM",
          amountCents: -reservation.amountCents, balanceAfterCents: charged.balanceCents, currencyCode: input.currencyCode,
          shop: input.shop, source: "SHOPIFY_ORDER", sourceId: input.shopifyOrderId,
          idempotencyKey: `redemption:${reservation.id}:applied`, description: `Nekudot usados en ${input.orderName}`,
        } });
        await transaction.nekudotRedemption.update({ where: { id: reservation.id }, data: { status: "APPLIED", appliedAt: new Date(), shopifyOrderId: input.shopifyOrderId } });
      } else if (input.eligibleFinancialStatus && ["APPLIED", "RESTORED"].includes(reservation.status)) {
        const targetRestoredCents = calculateRestoredRedemptionCents(
          reservation.amountCents,
          originalPurchaseCents,
          purchaseCents,
        );
        const restoreDelta = targetRestoredCents - reservation.restoredCents;
        if (restoreDelta) {
          const restored = await transaction.nekudotMember.update({
            where: { id: reservation.memberId },
            data: {
              balanceCents: { increment: restoreDelta },
              lifetimeRedeemedCents: { increment: -restoreDelta },
            },
          });
          await transaction.nekudotLedgerEntry.create({ data: {
            programKey: NEKUDOT_PROGRAM_KEY, memberId: reservation.memberId, walletType: "CLIENT",
            type: restoreDelta > 0 ? "REDEMPTION_REFUND" : "REDEMPTION_ADJUSTMENT",
            amountCents: restoreDelta, balanceAfterCents: restored.balanceCents, currencyCode: input.currencyCode,
            shop: input.shop, source: "SHOPIFY_ORDER", sourceId: input.shopifyOrderId,
            idempotencyKey: `redemption:${reservation.id}:refund:${hash}`,
            description: restoreDelta > 0
              ? `Restitución proporcional de Nekudot por devolución de ${input.orderName}`
              : `Ajuste de Nekudot restituidos en ${input.orderName}`,
          } });
          await transaction.nekudotRedemption.update({
            where: { id: reservation.id },
            data: {
              restoredCents: targetRestoredCents,
              status: targetRestoredCents >= reservation.amountCents ? "RESTORED" : "APPLIED",
            },
          });
        }
      }
    }

    let accrual = await transaction.nekudotOrderAccrual.findUnique({ where: { shop_shopifyOrderId: { shop: input.shop, shopifyOrderId: input.shopifyOrderId } } });
    if (accrual?.calculationHash === hash) return accrual;
    if (accrual && (!newOrderMember || accrual.memberId !== newOrderMember.id)) {
      await postMember(accrual.memberId, -accrual.clientEarnedCents, "old-member", `Reversión de ${input.orderName}`);
      if (accrual.brokerId) await postBroker(accrual.brokerId, -accrual.brokerEarnedCents, "old-broker", `Reversión de comisión de ${input.orderName}`);
      accrual = await transaction.nekudotOrderAccrual.update({ where: { id: accrual.id }, data: {
        ...(newOrderMember ? { memberId: newOrderMember.id, brokerId, cashbackTier, cashbackBasisPoints } : {}), originalPurchaseCents, purchaseCents: 0,
        clientEarnedCents: 0, brokerEarnedCents: 0, calculationHash: hash, processedAt: new Date(),
      } });
    }
    if (!newOrderMember) return accrual;
    await postMember(newOrderMember.id, target.clientEarnedCents - (accrual?.clientEarnedCents ?? 0), "current-member", target.clientEarnedCents >= (accrual?.clientEarnedCents ?? 0) ? `${cashbackBasisPoints / 100}% Nekudot ${cashbackTier} de ${input.orderName}` : `Ajuste por devolución de ${input.orderName}`);
    if (brokerId) await postBroker(brokerId, target.brokerEarnedCents - (accrual?.brokerEarnedCents ?? 0), "current-broker", target.brokerEarnedCents >= (accrual?.brokerEarnedCents ?? 0) ? `Comisión 5% de ${input.orderName}` : `Ajuste de comisión por devolución de ${input.orderName}`);
    return transaction.nekudotOrderAccrual.upsert({
      where: { shop_shopifyOrderId: { shop: input.shop, shopifyOrderId: input.shopifyOrderId } },
      create: { programKey: NEKUDOT_PROGRAM_KEY, shop: input.shop, shopifyOrderId: input.shopifyOrderId, orderName: input.orderName, memberId: newOrderMember.id, brokerId, cashbackTier, cashbackBasisPoints, originalPurchaseCents, purchaseCents: target.purchaseCents, clientEarnedCents: target.clientEarnedCents, brokerEarnedCents: target.brokerEarnedCents, currencyCode: input.currencyCode, calculationHash: hash },
      update: { orderName: input.orderName, memberId: newOrderMember.id, brokerId, cashbackTier, cashbackBasisPoints, originalPurchaseCents, purchaseCents: target.purchaseCents, clientEarnedCents: target.clientEarnedCents, brokerEarnedCents: target.brokerEarnedCents, currencyCode: input.currencyCode, calculationHash: hash, processedAt: new Date() },
    });
  });
}

export async function nekudotDashboard() {
  await expireNekudotReservations();
  const [members, brokers, balance, commissions, recentMembers, recentLedger] = await Promise.all([
    db.nekudotMember.count({ where: { programKey: NEKUDOT_PROGRAM_KEY, active: true } }),
    db.nekudotBroker.count({ where: { programKey: NEKUDOT_PROGRAM_KEY, active: true } }),
    db.nekudotMember.aggregate({ where: { programKey: NEKUDOT_PROGRAM_KEY, active: true }, _sum: { balanceCents: true, reservedCents: true } }),
    db.nekudotBroker.aggregate({ where: { programKey: NEKUDOT_PROGRAM_KEY, active: true }, _sum: { commissionBalanceCents: true } }),
    db.nekudotMember.findMany({ where: { programKey: NEKUDOT_PROGRAM_KEY, active: true }, include: { broker: true, credentials: { where: { active: true } }, identities: true }, orderBy: { updatedAt: "desc" }, take: 20 }),
    db.nekudotLedgerEntry.findMany({ where: { programKey: NEKUDOT_PROGRAM_KEY }, include: { member: true, broker: true }, orderBy: { occurredAt: "desc" }, take: 40 }),
  ]);
  return { metrics: { members, brokers, balanceCents: balance._sum.balanceCents ?? 0, reservedCents: balance._sum.reservedCents ?? 0, commissionBalanceCents: commissions._sum.commissionBalanceCents ?? 0 }, recentMembers, recentLedger };
}
