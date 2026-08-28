import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { assignRetailCustomerCredential, retailPosJsonError, searchRetailCustomers } from "../retail-pos.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return Response.json({ ok: true, customers: await searchRetailCustomers(request, query) });
  } catch (error) {
    return retailPosJsonError(error);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    const body = await request.json() as {
      customerId?: unknown;
      credential?: unknown;
      label?: unknown;
      managerPin?: unknown;
      replace?: unknown;
      identityVerified?: unknown;
    };
    const member = await assignRetailCustomerCredential(request, {
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
    return retailPosJsonError(error);
  }
}
