import type { LoaderFunctionArgs } from "react-router";
import { retailPosJsonError, searchRetailCustomers } from "../retail-pos.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const query = new URL(request.url).searchParams.get("q") ?? "";
    return Response.json({ ok: true, customers: await searchRetailCustomers(request, query) });
  } catch (error) {
    return retailPosJsonError(error);
  }
}
