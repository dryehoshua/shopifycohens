import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  assertRetailSameOrigin,
  clearRetailSessionCookie,
  currentRetailSession,
  loginRetailStaff,
  logoutRetailStaff,
  retailPosJsonError,
  retailSessionCookie,
} from "../retail-pos.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const session = await currentRetailSession(request, false);
    return Response.json({
      ok: true,
      authenticated: Boolean(session),
      staff: session ? { id: session.staff.id, name: session.staff.name, role: session.staff.role } : null,
    });
  } catch (error) {
    return retailPosJsonError(error);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    assertRetailSameOrigin(request);
    const body = (await request.json()) as { intent?: string; pin?: string };
    if (body.intent === "logout") {
      await logoutRetailStaff(request);
      return Response.json({ ok: true }, { headers: { "Set-Cookie": clearRetailSessionCookie() } });
    }
    if (body.intent !== "login") return Response.json({ ok: false, error: "Acción no válida." }, { status: 400 });
    const result = await loginRetailStaff(request, String(body.pin ?? ""));
    return Response.json(
      { ok: true, staff: result.staff, expiresAt: result.expiresAt },
      { headers: { "Set-Cookie": retailSessionCookie(result.token) } },
    );
  } catch (error) {
    return retailPosJsonError(error);
  }
}
