import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  assertSameOrigin,
  assignCafeCustomerCredential,
  cafePosJsonError,
  searchCafeCustomers,
} from "../cafe-pos.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return Response.json({ ok: true, customers: await searchCafeCustomers(request, query) });
  } catch (error) {
    return cafePosJsonError(error);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    assertSameOrigin(request);
    const body = await request.json() as {
      customerId?: unknown;
      credential?: unknown;
      label?: unknown;
      managerPin?: unknown;
      replace?: unknown;
      identityVerified?: unknown;
      cardTier?: unknown;
    };
    const member = await assignCafeCustomerCredential(request, {
      ...body,
      customerId: body.customerId,
      credential: body.credential,
    });
    return Response.json({
      ok: true,
      member,
      message: body.replace
        ? `Tarjeta reemplazada. ${member.displayName} conserva todo su saldo.`
        : `Tarjeta vinculada a ${member.displayName}.`,
    });
  } catch (error) {
    return cafePosJsonError(error);
  }
}
