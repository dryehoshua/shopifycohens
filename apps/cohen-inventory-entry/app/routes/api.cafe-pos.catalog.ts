import type { LoaderFunctionArgs } from "react-router";
import { cafePosJsonError, currentCafeSession, getCafeCatalog } from "../cafe-pos.server";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    await currentCafeSession(request);
    return Response.json({ ok: true, ...(await getCafeCatalog()) });
  } catch (error) {
    return cafePosJsonError(error);
  }
}
