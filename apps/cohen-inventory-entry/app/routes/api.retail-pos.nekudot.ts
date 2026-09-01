import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { assertRetailSameOrigin, currentRetailSession, retailPosJsonError } from "../retail-pos.server";
import { lookupNekudotMember, NekudotError } from "../nekudot.server";
import { cashbackBasisPointsForTier } from "../nekudot-domain";

function nekudotJsonError(error: unknown) {
  if (error instanceof NekudotError) {
    return Response.json(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  return retailPosJsonError(error);
}

function memberPayload(member: Awaited<ReturnType<typeof lookupNekudotMember>>) {
  return {
        id: member.id,
        displayName: member.displayName,
        email: member.email,
        cardTier: member.cardTier,
        cashbackBasisPoints: cashbackBasisPointsForTier(member.cardTier),
        balanceCents: member.balanceCents,
        reservedCents: member.reservedCents,
        availableCents: member.availableCents,
        customer: member.currentShopIdentity
          ? {
              id: member.currentShopIdentity.shopifyCustomerId,
              displayName: member.currentShopIdentity.displayName,
              email: member.currentShopIdentity.email,
            }
          : null,
        broker: member.broker ? { displayName: member.broker.displayName, code: member.broker.code } : null,
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const session = await currentRetailSession(request);
    const credential = new URL(request.url).searchParams.get("credential");
    const member = await lookupNekudotMember(session!.shop, credential);
    return Response.json({ ok: true, member: memberPayload(member) });
  } catch (error) {
    return nekudotJsonError(error);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    assertRetailSameOrigin(request);
    const session = await currentRetailSession(request);
    const body = await request.json() as { intent?: unknown; credential?: unknown };
    if (String(body.intent ?? "lookup") !== "lookup") {
      return Response.json({ ok: false, error: "Acción no válida." }, { status: 405 });
    }
    const member = await lookupNekudotMember(session!.shop, body.credential);
    return Response.json({ ok: true, member: memberPayload(member) });
  } catch (error) {
    return nekudotJsonError(error);
  }
}
