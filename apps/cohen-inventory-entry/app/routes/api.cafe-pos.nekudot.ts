import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  assertSameOrigin,
  cafePosJsonError,
  currentCafeSession,
} from "../cafe-pos.server";
import { lookupNekudotCustomer, lookupNekudotMember } from "../nekudot.server";
import { communityVoucherForMember } from "../community-wallet.server";
import { cashbackBasisPointsForTier } from "../nekudot-domain";

async function memberPayload(member: Awaited<ReturnType<typeof lookupNekudotMember>>) {
  const voucher = await communityVoucherForMember(member.id);
  return {
        communityVoucher: voucher ? { active: voucher.status === "ACTIVE", availableCents: voucher.availableCents, cardNumber: voucher.cardNumber } : null,
        id: member.id,
        displayName: member.displayName,
        email: member.email,
        cardTier: member.cardTier,
        cashbackBasisPoints: cashbackBasisPointsForTier(member.cardTier),
        balanceCents: member.balanceCents,
        reservedCents: member.reservedCents,
        availableCents: member.availableCents,
        broker: member.broker
          ? { displayName: member.broker.displayName, code: member.broker.code }
          : null,
        customer: member.currentShopIdentity
          ? {
              id: member.currentShopIdentity.shopifyCustomerId,
              displayName: member.currentShopIdentity.displayName,
              email: member.currentShopIdentity.email,
            }
          : null,
        linkedToCafeShop: Boolean(member.currentShopIdentity),
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const session = await currentCafeSession(request);
    const credential = new URL(request.url).searchParams.get("credential");
    const member = await lookupNekudotMember(session!.shop, credential);
    return Response.json({ ok: true, member: await memberPayload(member) });
  } catch (error) {
    return cafePosJsonError(error);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    assertSameOrigin(request);
    const session = await currentCafeSession(request);
    const body = await request.json() as { intent?: unknown; credential?: unknown; customerId?: unknown };
    if (String(body.intent ?? "lookup") !== "lookup") {
      return Response.json({ ok: false, error: "Acción no válida." }, { status: 405 });
    }
    const member = body.customerId
      ? await lookupNekudotCustomer(session!.shop, String(body.customerId))
      : await lookupNekudotMember(session!.shop, body.credential);
    return Response.json({ ok: true, member: await memberPayload(member) });
  } catch (error) {
    return cafePosJsonError(error);
  }
}
