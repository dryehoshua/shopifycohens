import type { LoaderFunctionArgs } from "react-router";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { authenticate } from "../shopify.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  await authenticate.public.appProxy(request);
  if (!["plata", "blue", "golden", "vales"].includes(params.card || "")) return new Response(null, { status: 404 });
  const bytes = await readFile(path.join(process.cwd(), "public", "nekudot", "cards", `${params.card}.webp`));
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/webp", "Cache-Control": "public, max-age=86400" } });
}
