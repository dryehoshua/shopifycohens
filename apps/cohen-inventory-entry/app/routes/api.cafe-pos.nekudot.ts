import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  assertSameOrigin,
  cafePosJsonError,
  currentCafeSession,
} from "../cafe-pos.server";
import { lookupNekudotMember } from "../nekudot.server";

function memberPayload(member: Awaited<ReturnType<typeof lookupNekudotMember>>) {
  return {
        id: member.id,
        displayName: member.displayName,
        email: member.email,
        balanceCents: member.balanceCents,
        reservedCents: member.reservedCents,
        availableCents: member.availableCents,
        broker: member.broker
          ? { displayName: member.broker.displayName, code: member.broker.code }
          : null,
        linkedToCafeShop: Boolean(member.currentShopIdentity),
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const session = await currentCafeSession(request);
    const credential = new URL(request.url).searchParams.get("credential");
    const member = await lookupNekudotMember(session!.shop, credential);
    return Response.json({ ok: true, member: memberPayload(member) });
  } catch (error) {
    return cafePosJsonError(error);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    assertSameOrigin(request);
    const session = await currentCafeSession(request);
    const body = await request.json() as { intent?: unknown; credential?: unknown };
    if (String(body.intent ?? "lookup") !== "lookup") {
      return Response.json({ ok: false, error: "Acción no válida." }, { status: 405 });
    }
    const member = await lookupNekudotMember(session!.shop, body.credential);
    return Response.json({ ok: true, member: memberPayload(member) });
  } catch (error) {
    return cafePosJsonError(error);
  }
}
