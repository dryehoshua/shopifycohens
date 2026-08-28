import type { LoaderFunctionArgs } from "react-router";
import { currentRetailSession, retailPosJsonError } from "../retail-pos.server";
import { lookupNekudotMember } from "../nekudot.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const session = await currentRetailSession(request);
    const credential = new URL(request.url).searchParams.get("credential");
    const member = await lookupNekudotMember(session!.shop, credential);
    return Response.json({
      ok: true,
      member: {
        id: member.id,
        displayName: member.displayName,
        email: member.email,
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
      },
    });
  } catch (error) {
    return retailPosJsonError(error);
  }
}
