import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  assertRetailSameOrigin,
  assignRetailCustomerCredential,
  retailPosJsonError,
} from "../retail-pos.server";
import {
  activateRetailCustomerMembership,
  getRetailCustomerMembership,
  listRetailCustomerProfiles,
  removeRetailCustomerCredential,
  saveRetailCustomerProfile,
  syncRetailAssignedMembership,
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
    if (body.intent === "membershipDetails") {
      return Response.json({ ok: true, ...await getRetailCustomerMembership(request, body.customerId) });
    }
    if (body.intent === "activateMembership") {
      return Response.json({
        ok: true,
        ...await activateRetailCustomerMembership(request, body),
        message: "Tarjeta virtual Nekudot activada y sincronizada con Shopify Retail.",
      });
    }
    if (body.intent === "removeCredential") {
      return Response.json({
        ok: true,
        ...await removeRetailCustomerCredential(request, body),
        message: "Tarjeta eliminada. El historial permanece registrado.",
      });
    }
    const member = await assignRetailCustomerCredential(request, {
      ...body,
      customerId: body.customerId,
      credential: body.credential,
    });
    const synchronized = await syncRetailAssignedMembership(request, body.customerId);
    return Response.json({
      ok: true,
      member,
      customer: synchronized.customer,
      membership: synchronized.membership,
      message: body.replace
        ? `Tarjeta reemplazada y sincronizada con Shopify Retail. ${member.displayName} conserva todo su saldo.`
        : `Tarjeta vinculada a ${member.displayName} y sincronizada con Shopify Retail.`,
    });
  } catch (error) {
    return retailPosJsonError(error);
  }
}
