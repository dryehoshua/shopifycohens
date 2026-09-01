import type { LoaderFunctionArgs } from "react-router";
import { portalMember, readMemberPhoto } from "../nekudot-registration.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const member = await portalMember(request);
  if (!member || member.id !== params.memberId || !member.photoFileName) throw new Response("No encontrado", { status: 404 });
  const bytes = await readMemberPhoto(member.photoFileName);
  const extension = member.photoFileName.split(".").pop();
  const contentType = extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : "image/jpeg";
  return new Response(bytes, { headers: { "Content-Type": contentType, "Cache-Control": "private, max-age=3600" } });
}
