import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";

function valueAsString(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return null;
}

function dateOrNull(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhookHeader = request.headers.get("X-Shopify-Webhook-Id");
  const triggeredAtHeader = request.headers.get("X-Shopify-Triggered-At");
  const { payload, shop, topic } = await authenticate.webhook(request);
  const data = payload as Record<string, unknown>;
  const normalizedTopic = String(topic).toLowerCase();

  const fallbackWebhookId = createHash("sha256")
    .update(`${shop}:${topic}:${JSON.stringify(data)}`)
    .digest("hex");
  const webhookId = webhookHeader || fallbackWebhookId;
  const resourceId = valueAsString(data.id);
  const locationId = valueAsString(
    data.location_id ?? data.locationId,
  );
  const inventoryItemId = valueAsString(
    data.inventory_item_id ??
      data.inventoryItemId ??
      (normalizedTopic.includes("inventory_item") ? data.id : null),
  );
  const productId = valueAsString(
    data.product_id ??
      data.productId ??
      (normalizedTopic.includes("product") ? data.id : null),
  );
  const occurredAt =
    dateOrNull(triggeredAtHeader) ||
    dateOrNull(data.updated_at) ||
    dateOrNull(data.updatedAt);

  try {
    await db.inventoryAuditEvent.create({
      data: {
        webhookId,
        shop,
        topic: String(topic),
        occurredAt,
        resourceId,
        locationId,
        inventoryItemId,
        productId,
        payload: data as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    const known = error as { code?: string };
    if (known.code !== "P2002") throw error;
  }

  return new Response(null, { status: 200 });
};
