import { randomBytes, randomUUID } from "node:crypto";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import db from "./db.server";
import {
  cancelNekudotReservation,
  NekudotError,
  reserveNekudotForMember,
} from "./nekudot.server";

const DEFAULT_STOREFRONT_URL = "https://cohenskosher.com";
const ONLINE_REDEMPTION_MIN_CENTS = 100;

type DiscountMutationPayload = {
  data?: {
    discountCodeBasicCreate?: {
      codeDiscountNode?: { id: string } | null;
      userErrors?: Array<{ field?: string[] | null; message: string }>;
    };
    discountCodeDelete?: {
      deletedCodeDiscountId?: string | null;
      userErrors?: Array<{ field?: string[] | null; message: string }>;
    };
  };
  errors?: Array<{ message?: string }>;
};

function mutationError(payload: DiscountMutationPayload, field: "discountCodeBasicCreate" | "discountCodeDelete") {
  const topLevel = payload.errors?.map((error) => error.message || "Error GraphQL").filter(Boolean) || [];
  const userErrors = payload.data?.[field]?.userErrors?.map((error) => error.message).filter(Boolean) || [];
  return [...topLevel, ...userErrors].join("; ");
}

async function deleteDiscount(admin: AdminApiContext, id: string) {
  const response = await admin.graphql(`#graphql
    mutation DeleteNekudotDiscount($id: ID!) {
      discountCodeDelete(id: $id) {
        deletedCodeDiscountId
        userErrors { field message }
      }
    }
  `, { variables: { id } });
  const payload = await response.json() as DiscountMutationPayload;
  const error = mutationError(payload, "discountCodeDelete");
  if (error) throw new NekudotError(`No pudimos reemplazar el canje anterior: ${error}`, 502, "SHOPIFY_DISCOUNT_DELETE");
}

async function cancelPreviousOnlineRedemptions(admin: AdminApiContext, shop: string, memberId: string) {
  const previous = await db.nekudotRedemption.findMany({
    where: {
      shop,
      memberId,
      status: "RESERVED",
      discountCode: { not: null },
      shopifyDiscountId: { not: null },
    },
    orderBy: { createdAt: "asc" },
  });
  for (const redemption of previous) {
    await deleteDiscount(admin, redemption.shopifyDiscountId!);
    await cancelNekudotReservation(shop, redemption.id);
  }
}

export function normalizeOnlineRedemptionCents(value: unknown, availableCents: number) {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    throw new NekudotError("Escribe una cantidad válida de Nekudot.");
  }
  const amountCents = Math.round(Number(normalized) * 100);
  if (amountCents < ONLINE_REDEMPTION_MIN_CENTS) {
    throw new NekudotError("El canje mínimo es de $1.00 MXN.");
  }
  if (!Number.isInteger(availableCents) || availableCents < amountCents) {
    throw new NekudotError("Tu saldo disponible no alcanza para ese canje.", 409, "INSUFFICIENT_BALANCE");
  }
  return amountCents;
}

export async function createOnlineNekudotRedemption(input: {
  admin: AdminApiContext;
  shop: string;
  customerId: string;
  memberId: string;
  amount: unknown;
  cartReference?: string | null;
}) {
  const member = await db.nekudotMember.findFirst({
    where: { id: input.memberId, active: true },
    select: { id: true, displayName: true, balanceCents: true, reservedCents: true },
  });
  if (!member) throw new NekudotError("No encontramos una membresía Nekudot activa.", 404, "MEMBER_NOT_FOUND");

  await cancelPreviousOnlineRedemptions(input.admin, input.shop, input.memberId);
  const refreshed = await db.nekudotMember.findUniqueOrThrow({
    where: { id: member.id },
    select: { balanceCents: true, reservedCents: true },
  });
  const amountCents = normalizeOnlineRedemptionCents(
    input.amount,
    refreshed.balanceCents - refreshed.reservedCents,
  );
  const code = `NEKUDOT-${randomBytes(8).toString("hex").toUpperCase()}`;
  const reservation = await reserveNekudotForMember({
    shop: input.shop,
    memberId: input.memberId,
    amountCents,
    cartReference: input.cartReference || `online:${code}`,
    idempotencyKey: `online:${input.memberId}:${randomUUID()}`,
  });

  try {
    const response = await input.admin.graphql(`#graphql
      mutation CreateNekudotDiscount($discount: DiscountCodeBasicInput!) {
        discountCodeBasicCreate(basicCodeDiscount: $discount) {
          codeDiscountNode { id }
          userErrors { field message }
        }
      }
    `, {
      variables: {
        discount: {
          title: `Nekudot · ${member.displayName} · ${reservation.id.slice(-6)}`,
          code,
          startsAt: new Date(Date.now() - 60_000).toISOString(),
          endsAt: reservation.expiresAt.toISOString(),
          context: { customers: { add: [input.customerId] } },
          customerGets: {
            value: {
              discountAmount: {
                amount: (amountCents / 100).toFixed(2),
                appliesOnEachItem: false,
              },
            },
            items: { all: true },
          },
          appliesOncePerCustomer: true,
          usageLimit: 1,
          combinesWith: {
            orderDiscounts: false,
            productDiscounts: false,
            shippingDiscounts: false,
          },
        },
      },
    });
    const payload = await response.json() as DiscountMutationPayload;
    const error = mutationError(payload, "discountCodeBasicCreate");
    const shopifyDiscountId = payload.data?.discountCodeBasicCreate?.codeDiscountNode?.id;
    if (error || !shopifyDiscountId) {
      throw new NekudotError(
        `Shopify no pudo crear el descuento${error ? `: ${error}` : "."}`,
        502,
        "SHOPIFY_DISCOUNT_CREATE",
      );
    }
    const saved = await db.nekudotRedemption.update({
      where: { id: reservation.id },
      data: { discountCode: code, shopifyDiscountId },
    });
    const storefront = (process.env.SHOP_STOREFRONT_URL || DEFAULT_STOREFRONT_URL).replace(/\/$/, "");
    return {
      ...saved,
      discountApplyUrl: `${storefront}/discount/${encodeURIComponent(code)}?redirect=${encodeURIComponent("/cart")}`,
    };
  } catch (error) {
    await cancelNekudotReservation(input.shop, reservation.id).catch(() => undefined);
    throw error;
  }
}
