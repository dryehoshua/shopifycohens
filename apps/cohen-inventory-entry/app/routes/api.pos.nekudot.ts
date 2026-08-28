import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { shopDomainFromDestination } from "../inventory.server";
import {
  cancelNekudotReservation,
  lookupNekudotMember,
  NekudotError,
  reserveNekudot,
} from "../nekudot.server";
import { syncSalesOrderFromAdmin } from "../sales-sync.server";
import { authenticate, unauthenticated } from "../shopify.server";

function memberPayload(member: Awaited<ReturnType<typeof lookupNekudotMember>>) {
  return {
    id: member.id,
    displayName: member.displayName,
    email: member.email,
    balanceCents: member.balanceCents,
    reservedCents: member.reservedCents,
    availableCents: member.availableCents,
    broker: member.broker ? { displayName: member.broker.displayName, code: member.broker.code } : null,
    currentShopIdentity: member.currentShopIdentity
      ? {
          shopifyCustomerId: member.currentShopIdentity.shopifyCustomerId,
          legacyCustomerId: member.currentShopIdentity.shopifyLegacyCustomerId,
        }
      : null,
  };
}

function errorResponse(error: unknown) {
  return Response.json(
    {
      ok: false,
      error: error instanceof Error ? error.message : "Error desconocido.",
      ...(error instanceof NekudotError ? { code: error.code } : {}),
    },
    { status: error instanceof NekudotError ? error.status : 400 },
  );
}

function shopifyOrderGid(value: unknown) {
  const raw = String(value ?? "").trim();
  const id = raw.startsWith("gid://shopify/Order/") ? raw : `gid://shopify/Order/${raw}`;
  if (!/^gid:\/\/shopify\/Order\/\d+$/.test(id)) {
    throw new NekudotError("El pedido de Shopify no es válido.", 400, "INVALID_ORDER_ID");
  }
  return id;
}

async function attachMemberToCompletedOrder(input: {
  shop: string;
  orderId: unknown;
  credential: unknown;
}) {
  const member = await lookupNekudotMember(input.shop, input.credential);
  if (!member.currentShopIdentity) {
    throw new NekudotError(
      "La tarjeta existe, pero falta vincular el cliente de esta tienda.",
      409,
      "SHOP_IDENTITY_MISSING",
    );
  }
  const orderId = shopifyOrderGid(input.orderId);
  const { admin } = await unauthenticated.admin(input.shop);
  const orderResponse = await admin.graphql(`#graphql
    query NekudotPostPurchaseOrder($id: ID!) {
      order(id: $id) {
        id name cancelledAt displayFinancialStatus
        customer { id }
        customAttributes { key value }
      }
    }
  `, { variables: { id: orderId } });
  const orderPayload = (await orderResponse.json()) as {
    data?: { order?: {
      id: string;
      name: string;
      cancelledAt: string | null;
      displayFinancialStatus: string | null;
      customer: { id: string } | null;
      customAttributes: Array<{ key: string; value: string }>;
    } | null };
    errors?: Array<{ message?: string }>;
  };
  if (orderPayload.errors?.length) {
    throw new NekudotError(orderPayload.errors.map((error) => error.message || "Error de Shopify").join("; "), 502, "SHOPIFY_GRAPHQL");
  }
  const order = orderPayload.data?.order;
  if (!order) throw new NekudotError("Shopify no encontró el pedido terminado.", 404, "ORDER_NOT_FOUND");
  if (order.cancelledAt || !new Set(["PAID", "PARTIALLY_PAID", "PARTIALLY_REFUNDED", "REFUNDED"]).has(order.displayFinancialStatus ?? "")) {
    throw new NekudotError("El pedido todavía no está pagado o fue cancelado.", 409, "ORDER_NOT_ELIGIBLE");
  }
  if (order.customer && order.customer.id !== member.currentShopIdentity.shopifyCustomerId) {
    throw new NekudotError(
      "El pedido ya pertenece a otro cliente. Revisa el perfil antes de acreditar puntos.",
      409,
      "ORDER_CUSTOMER_CONFLICT",
    );
  }

  if (!order.customer) {
    const customerResponse = await admin.graphql(`#graphql
      mutation NekudotSetOrderCustomer($orderId: ID!, $customerId: ID!) {
        orderCustomerSet(orderId: $orderId, customerId: $customerId) {
          order { id }
          userErrors { field message }
        }
      }
    `, { variables: { orderId, customerId: member.currentShopIdentity.shopifyCustomerId } });
    const customerPayload = (await customerResponse.json()) as {
      data?: { orderCustomerSet?: { userErrors: Array<{ message: string }> } };
      errors?: Array<{ message?: string }>;
    };
    const customerErrors = [
      ...(customerPayload.errors?.map((error) => error.message || "Error de Shopify") ?? []),
      ...(customerPayload.data?.orderCustomerSet?.userErrors.map((error) => error.message) ?? []),
    ];
    if (customerErrors.length) throw new NekudotError(customerErrors.join("; "), 502, "ORDER_CUSTOMER_SET_FAILED");
  }

  const attributes = new Map(order.customAttributes.map((attribute) => [attribute.key, attribute.value]));
  attributes.set("nekudot_member_id", member.id);
  attributes.set("nekudot_identified_after_purchase", "true");
  const updateResponse = await admin.graphql(`#graphql
    mutation NekudotMarkOrder($input: OrderInput!) {
      orderUpdate(input: $input) {
        order { id name }
        userErrors { field message }
      }
    }
  `, { variables: { input: {
    id: orderId,
    customAttributes: [...attributes].map(([key, value]) => ({ key, value })),
  } } });
  const updatePayload = (await updateResponse.json()) as {
    data?: { orderUpdate?: { userErrors: Array<{ message: string }> } };
    errors?: Array<{ message?: string }>;
  };
  const updateErrors = [
    ...(updatePayload.errors?.map((error) => error.message || "Error de Shopify") ?? []),
    ...(updatePayload.data?.orderUpdate?.userErrors.map((error) => error.message) ?? []),
  ];
  if (updateErrors.length) throw new NekudotError(updateErrors.join("; "), 502, "ORDER_UPDATE_FAILED");

  await syncSalesOrderFromAdmin({
    admin,
    sourceShop: input.shop,
    orderId,
    webhookId: `pos-post-purchase:${orderId}:${member.id}`,
    topic: "POS_POST_PURCHASE",
  });
  const [accrual, refreshedMember] = await Promise.all([
    db.nekudotOrderAccrual.findUnique({
      where: { shop_shopifyOrderId: { shop: input.shop, shopifyOrderId: orderId } },
    }),
    lookupNekudotMember(input.shop, input.credential),
  ]);
  return {
    orderId,
    orderName: order.name,
    earnedCents: accrual?.clientEarnedCents ?? 0,
    member: memberPayload(refreshedMember),
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { sessionToken, cors } = await authenticate.pos(request);
  try {
    const shop = shopDomainFromDestination(sessionToken.dest);
    const credential = new URL(request.url).searchParams.get("credential");
    const member = await lookupNekudotMember(shop, credential);
    return cors(Response.json({ ok: true, member: memberPayload(member) }));
  } catch (error) {
    return cors(errorResponse(error));
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { sessionToken, cors } = await authenticate.pos(request);
  try {
    const shop = shopDomainFromDestination(sessionToken.dest);
    const body = (await request.json()) as Record<string, unknown>;
    const intent = String(body.intent ?? "reserve");
    if (intent === "attach_order") {
      const result = await attachMemberToCompletedOrder({
        shop,
        orderId: body.orderId,
        credential: body.credential,
      });
      return cors(Response.json({ ok: true, ...result }));
    }
    if (intent === "cancel") {
      const reservation = await cancelNekudotReservation(shop, String(body.reservationId ?? ""));
      return cors(Response.json({ ok: true, reservation }));
    }
    if (intent !== "reserve") throw new NekudotError("Acción no válida.", 405);
    const reservation = await reserveNekudot({
      shop,
      rawToken: body.credential,
      amount: body.amount,
      cartTotalCents: body.cartTotalCents,
      cartReference: body.cartReference,
      idempotencyKey: body.idempotencyKey,
    });
    return cors(Response.json({
      ok: true,
      reservation: {
        id: reservation.id,
        amountCents: reservation.amountCents,
        expiresAt: reservation.expiresAt.toISOString(),
      },
    }));
  } catch (error) {
    return cors(errorResponse(error));
  }
};
