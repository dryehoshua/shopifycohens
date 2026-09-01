import type { ActionFunctionArgs } from "react-router";
import { processMercadoPagoWebhook, RegistrationError } from "../nekudot-registration.server";

export async function action({ request }: ActionFunctionArgs) {
  try {
    return Response.json({ ok: true, ...(await processMercadoPagoWebhook(request)) });
  } catch (error) {
    const caught = error instanceof RegistrationError ? error : new RegistrationError("No se pudo procesar la notificación.", 500);
    return Response.json({ ok: false, error: caught.message }, { status: caught.status });
  }
}
