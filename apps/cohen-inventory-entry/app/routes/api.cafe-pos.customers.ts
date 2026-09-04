import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  assertSameOrigin,
  assignCafeCustomerCredential,
  cafePosJsonError,
} from "../cafe-pos.server";
import {
  activateCafeCustomerMembership,
  getCafeCustomerMembership,
  listCafeCustomerProfiles,
  removeCafeCustomerCredential,
  saveCafeCustomerProfile,
  syncCafeAssignedMembership,
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
    if (body.intent === "membershipDetails") {
      return Response.json({ ok: true, ...await getCafeCustomerMembership(request, body.customerId) });
    }
    if (body.intent === "activateMembership") {
      return Response.json({
        ok: true,
        ...await activateCafeCustomerMembership(request, body),
        message: "Tarjeta virtual Nekudot activada y sincronizada con Shopify Café.",
      });
    }
    if (body.intent === "removeCredential") {
      return Response.json({
        ok: true,
        ...await removeCafeCustomerCredential(request, body),
        message: "Tarjeta eliminada. El historial permanece registrado.",
      });
    }
    const member = await assignCafeCustomerCredential(request, {
      ...body,
      customerId: body.customerId,
      credential: body.credential,
    });
    const synchronized = await syncCafeAssignedMembership(request, body.customerId);
    return Response.json({
      ok: true,
      member,
      customer: synchronized.customer,
      membership: synchronized.membership,
      message: body.replace
        ? `Tarjeta reemplazada y sincronizada con Shopify Café. ${member.displayName} conserva todo su saldo.`
        : `Tarjeta vinculada a ${member.displayName} y sincronizada con Shopify Café.`,
    });
  } catch (error) {
    return cafePosJsonError(error);
  }
}
