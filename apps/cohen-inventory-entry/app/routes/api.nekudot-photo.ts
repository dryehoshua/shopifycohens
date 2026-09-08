import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { verifyMemberPhotoSignature } from "../nekudot-photo-url.server";
import { readMemberPhoto } from "../nekudot-registration.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const memberId = String(url.searchParams.get("member") || "");
  const fileName = String(url.searchParams.get("file") || "");
  const expires = Number(url.searchParams.get("expires"));
  const signature = String(url.searchParams.get("signature") || "");
  if (!verifyMemberPhotoSignature(memberId, fileName, expires, signature)) throw new Response("No autorizado", { status: 401 });
  const member = await db.nekudotMember.findFirst({ where: { id: memberId, active: true }, select: { photoFileName: true } });
  if (!member?.photoFileName || member.photoFileName !== fileName) throw new Response("No encontrado", { status: 404 });
  const bytes = await readMemberPhoto(fileName);
  const extension = fileName.split(".").pop();
  const contentType = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
  return new Response(bytes, { headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=3600" } });
}
