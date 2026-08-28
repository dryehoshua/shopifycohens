import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  assertRetailSameOrigin,
  createRetailStaff,
  listRetailStaff,
  requireRetailManager,
  retailPosJsonError,
  setRetailStaffActive,
} from "../retail-pos.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { session } = await requireRetailManager(request);
    return Response.json({ ok: true, staff: await listRetailStaff(session.shop) });
  } catch (error) {
    return retailPosJsonError(error);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    assertRetailSameOrigin(request);
    const body = (await request.json()) as Record<string, unknown>;
    const { session } = await requireRetailManager(request);
    if (body.intent === "create") {
      await createRetailStaff(session.shop, String(body.name ?? ""), String(body.pin ?? ""));
    } else if (body.intent === "toggle") {
      await setRetailStaffActive(session.shop, String(body.staffId ?? ""), Boolean(body.active));
    } else {
      return Response.json({ ok: false, error: "Acción no válida." }, { status: 400 });
    }
    return Response.json({ ok: true, staff: await listRetailStaff(session.shop) });
  } catch (error) {
    return retailPosJsonError(error);
  }
}
