import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  assertRetailSameOrigin,
  markRetailReceiptPrinted,
  retailPosJsonError,
  retailReceipt,
} from "../retail-pos.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    return Response.json({ ok: true, sale: await retailReceipt(request, String(params.saleId ?? "")) });
  } catch (error) {
    return retailPosJsonError(error);
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  try {
    assertRetailSameOrigin(request);
    return Response.json({ ok: true, sale: await markRetailReceiptPrinted(request, String(params.saleId ?? "")) });
  } catch (error) {
    return retailPosJsonError(error);
  }
}
