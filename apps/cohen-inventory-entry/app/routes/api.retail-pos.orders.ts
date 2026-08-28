import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  assertRetailSameOrigin,
  createRetailSale,
  recentRetailSales,
  refundRetailSale,
  retailPosJsonError,
  retryRetailSale,
} from "../retail-pos.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? "30");
    return Response.json({ ok: true, sales: await recentRetailSales(request, limit) });
  } catch (error) {
    return retailPosJsonError(error);
  }
}

export async function action({ request }: ActionFunctionArgs) {
  try {
    assertRetailSameOrigin(request);
    const body = (await request.json()) as Record<string, unknown>;
    if (body.refundSaleId) {
      return Response.json({ ok: true, sale: await refundRetailSale(request, String(body.refundSaleId), body.managerPin) });
    }
    if (body.retrySaleId) {
      return Response.json({ ok: true, sale: await retryRetailSale(request, String(body.retrySaleId)) });
    }
    return Response.json({ ok: true, sale: await createRetailSale(request, body) });
  } catch (error) {
    return retailPosJsonError(error);
  }
}
