import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  assertSameOrigin,
  cafePosJsonError,
  createCafeStaff,
  listCafeStaff,
  makeCafeInventoryUnlimited,
  requireCafeManager,
  setCafeStaffActive,
} from "../cafe-pos.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const { session } = await requireCafeManager(request);
    return Response.json({ ok: true, staff: await listCafeStaff(session.shop) });
  } catch (error) {
    return cafePosJsonError(error);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    assertSameOrigin(request);
    const body = (await request.json()) as Record<string, unknown>;
    const { session } = await requireCafeManager(request);
    let inventoryUpdated: number | undefined;
    if (body.intent === "create") {
      await createCafeStaff(session.shop, String(body.name ?? ""), String(body.pin ?? ""));
    } else if (body.intent === "toggle") {
      await setCafeStaffActive(session.shop, String(body.staffId ?? ""), Boolean(body.active));
    } else if (body.intent === "unlimitedInventory") {
      inventoryUpdated = (await makeCafeInventoryUnlimited(request)).updated;
    } else {
      return Response.json({ ok: false, error: "Acción no válida." }, { status: 400 });
    }
    return Response.json({ ok: true, staff: await listCafeStaff(session.shop), inventoryUpdated });
  } catch (error) {
    return cafePosJsonError(error);
  }
}
