import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  assertSameOrigin,
  refundCafeSale,
  cafePosJsonError,
  createCafeSale,
  recentCafeSales,
  retryCafeSale,
} from "../cafe-pos.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? "30");
    return Response.json({ ok: true, sales: await recentCafeSales(request, limit) });
  } catch (error) {
    return cafePosJsonError(error);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    assertSameOrigin(request);
    const body = (await request.json()) as Record<string, unknown>;
    if (body.refundSaleId) {
      return Response.json({
        ok: true,
        sale: await refundCafeSale(request, String(body.refundSaleId), body.managerPin),
      });
    }
    if (body.retrySaleId) {
      return Response.json({ ok: true, sale: await retryCafeSale(request, String(body.retrySaleId)) });
    }
    return Response.json({ ok: true, sale: await createCafeSale(request, body) });
  } catch (error) {
    return cafePosJsonError(error);
  }
}
