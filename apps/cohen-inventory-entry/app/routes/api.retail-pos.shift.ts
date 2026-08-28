import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  assertRetailSameOrigin,
  closeRetailShift,
  currentRetailSession,
  currentRetailShift,
  openRetailShift,
  retailPosJsonError,
} from "../retail-pos.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const session = await currentRetailSession(request);
    return Response.json({ ok: true, shift: await currentRetailShift(session!.shop) });
  } catch (error) {
    return retailPosJsonError(error);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    assertRetailSameOrigin(request);
    const body = (await request.json()) as Record<string, unknown>;
    if (body.intent === "open") return Response.json({ ok: true, shift: await openRetailShift(request, body.openingCash) });
    if (body.intent === "close") {
      return Response.json({
        ok: true,
        shift: await closeRetailShift(request, {
          closingCash: body.closingCash,
          terminalCounted: body.terminalCounted,
          notes: body.notes,
        }),
      });
    }
    return Response.json({ ok: false, error: "Acción no válida." }, { status: 400 });
  } catch (error) {
    return retailPosJsonError(error);
  }
}
