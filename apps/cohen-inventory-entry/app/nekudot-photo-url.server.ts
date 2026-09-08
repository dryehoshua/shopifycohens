import { createHmac, timingSafeEqual } from "node:crypto";

const DEFAULT_BACKEND = "https://cohens-operations-production.up.railway.app";

function signingSecret() {
  const secret = process.env.NEKUDOT_PHOTO_SIGNING_SECRET?.trim() || process.env.SHOPIFY_API_SECRET?.trim();
  if (!secret) throw new Error("Falta el secreto para firmar fotos Nekudot.");
  return secret;
}

function signature(memberId: string, fileName: string, expires: number) {
  return createHmac("sha256", signingSecret()).update(`${memberId}:${fileName}:${expires}`).digest("base64url");
}

export function signedMemberPhotoUrl(memberId: string, fileName: string) {
  const expires = Math.floor(Date.now() / 1000) + 60 * 60;
  const origin = (process.env.SHOPIFY_APP_URL || DEFAULT_BACKEND).replace(/\/$/, "");
  const params = new URLSearchParams({ member: memberId, file: fileName, expires: String(expires), signature: signature(memberId, fileName, expires) });
  return `${origin}/api/nekudot-photo?${params}`;
}

export function verifyMemberPhotoSignature(memberId: string, fileName: string, expires: number, value: string) {
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isInteger(expires) || expires < now || expires > now + 3700) return false;
  const expected = Buffer.from(signature(memberId, fileName, expires));
  const received = Buffer.from(value || "");
  return expected.length === received.length && timingSafeEqual(expected, received);
}
