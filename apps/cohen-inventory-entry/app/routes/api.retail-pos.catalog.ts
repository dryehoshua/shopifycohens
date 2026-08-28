import type { LoaderFunctionArgs } from "react-router";
import { currentRetailSession, getRetailCatalog, retailPosJsonError } from "../retail-pos.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    await currentRetailSession(request);
    const search = new URL(request.url).searchParams.get("q") ?? "";
    return Response.json({ ok: true, ...(await getRetailCatalog(search)) });
  } catch (error) {
    return retailPosJsonError(error);
  }
}
