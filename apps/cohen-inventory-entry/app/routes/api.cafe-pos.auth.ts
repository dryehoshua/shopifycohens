import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  assertSameOrigin,
  cafePosJsonError,
  clearSessionCookie,
  currentCafeSession,
  loginCafeStaff,
  logoutCafeStaff,
  sessionCookie,
} from "../cafe-pos.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const session = await currentCafeSession(request, false);
    return Response.json({
      ok: true,
      authenticated: Boolean(session),
      staff: session ? { id: session.staff.id, name: session.staff.name } : null,
    });
  } catch (error) {
    return cafePosJsonError(error);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    assertSameOrigin(request);
    const body = (await request.json()) as { intent?: string; pin?: string };
    if (body.intent === "logout") {
      await logoutCafeStaff(request);
      return Response.json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
    }
    if (body.intent !== "login") return Response.json({ ok: false, error: "Acción no válida." }, { status: 400 });
    const result = await loginCafeStaff(request, String(body.pin ?? ""));
    return Response.json(
      { ok: true, staff: result.staff, expiresAt: result.expiresAt },
      { headers: { "Set-Cookie": sessionCookie(result.token) } },
    );
  } catch (error) {
    return cafePosJsonError(error);
  }
}
