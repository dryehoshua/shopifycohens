import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  assertRetailSameOrigin,
  assignRetailCustomerCredential,
  retailPosJsonError,
} from "../retail-pos.server";
import {
  listRetailCustomerProfiles,
  saveRetailCustomerProfile,
} from "../cafe-customer-profile.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return Response.json({ ok: true, customers: await listRetailCustomerProfiles(request, query) });
  } catch (error) {
    return retailPosJsonError(error);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    assertRetailSameOrigin(request);
    const body = await request.json() as {
      intent?: unknown;
      customerId?: unknown;
      credential?: unknown;
      label?: unknown;
      managerPin?: unknown;
      replace?: unknown;
      identityVerified?: unknown;
      cardTier?: unknown;
      [key: string]: unknown;
    };
    if (body.intent === "saveProfile") {
      const customer = await saveRetailCustomerProfile(request, body);
      return Response.json({
        ok: true,
        customer,
        message: body.customerId ? "Datos del cliente actualizados." : "Cliente creado en Shopify Retail.",
      });
    }
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
