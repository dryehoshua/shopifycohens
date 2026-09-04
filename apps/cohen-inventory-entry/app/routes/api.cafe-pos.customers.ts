import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  assertSameOrigin,
  assignCafeCustomerCredential,
  cafePosJsonError,
} from "../cafe-pos.server";
import {
  listCafeCustomerProfiles,
  saveCafeCustomerProfile,
} from "../cafe-customer-profile.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return Response.json({ ok: true, customers: await listCafeCustomerProfiles(request, query) });
  } catch (error) {
    return cafePosJsonError(error);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    assertSameOrigin(request);
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
      const customer = await saveCafeCustomerProfile(request, body);
      return Response.json({
        ok: true,
        customer,
        message: body.customerId ? "Datos del cliente actualizados." : "Cliente creado en Shopify Café.",
      });
    }
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
