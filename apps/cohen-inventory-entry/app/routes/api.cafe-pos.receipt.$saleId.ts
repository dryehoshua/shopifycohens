import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  assertSameOrigin,
  cafePosJsonError,
  cafeReceipt,
  markCafeReceiptPrinted,
} from "../cafe-pos.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  try {
    return Response.json({ ok: true, sale: await cafeReceipt(request, String(params.saleId ?? "")) });
  } catch (error) {
    return cafePosJsonError(error);
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  try {
    assertSameOrigin(request);
    return Response.json({ ok: true, sale: await markCafeReceiptPrinted(request, String(params.saleId ?? "")) });
  } catch (error) {
    return cafePosJsonError(error);
  }
}
