import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  assertSameOrigin,
  cafePosJsonError,
  closeCafeShift,
  currentCafeSession,
  currentCafeShift,
  openCafeShift,
} from "../cafe-pos.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const session = await currentCafeSession(request);
    return Response.json({ ok: true, shift: await currentCafeShift(session!.shop) });
  } catch (error) {
    return cafePosJsonError(error);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    assertSameOrigin(request);
    const body = (await request.json()) as Record<string, unknown>;
    if (body.intent === "open") {
      return Response.json({ ok: true, shift: await openCafeShift(request, body.openingCash) });
    }
    if (body.intent === "close") {
      return Response.json({
        ok: true,
        shift: await closeCafeShift(request, {
          closingCash: body.closingCash,
          terminalCounted: body.terminalCounted,
          notes: body.notes,
        }),
      });
    }
    return Response.json({ ok: false, error: "Acción no válida." }, { status: 400 });
  } catch (error) {
    return cafePosJsonError(error);
  }
}
