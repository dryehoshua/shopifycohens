import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { shopDomainFromDestination } from "../inventory.server";
import {
  cancelNekudotReservation,
  lookupNekudotMember,
  NekudotError,
  reserveNekudot,
} from "../nekudot.server";
import { authenticate } from "../shopify.server";

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
