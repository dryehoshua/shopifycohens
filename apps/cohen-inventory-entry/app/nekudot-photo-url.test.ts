import assert from "node:assert/strict";
import test from "node:test";
import { signedMemberPhotoUrl, verifyMemberPhotoSignature } from "./nekudot-photo-url.server.ts";

test("firma fotos privadas y rechaza una firma alterada", () => {
  process.env.NEKUDOT_PHOTO_SIGNING_SECRET = "test-secret-with-enough-entropy";
  process.env.SHOPIFY_APP_URL = "https://example.test";
  const url = new URL(signedMemberPhotoUrl("member-1", "member-1-0123456789abcdef.jpg"));
  const expires = Number(url.searchParams.get("expires"));
  const signature = String(url.searchParams.get("signature"));
  assert.equal(verifyMemberPhotoSignature("member-1", "member-1-0123456789abcdef.jpg", expires, signature), true);
  assert.equal(verifyMemberPhotoSignature("member-2", "member-1-0123456789abcdef.jpg", expires, signature), false);
});
