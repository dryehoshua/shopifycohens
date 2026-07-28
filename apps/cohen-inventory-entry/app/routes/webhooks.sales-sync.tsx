import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { syncSalesOrderFromAdmin } from "../sales-sync.server";

function orderGid(topic: string, payload: Record<string, unknown>) {
  const raw =
    topic.toLowerCase() === "refunds_create"
      ? payload.order_id ?? payload.orderId
      : payload.admin_graphql_api_id ??
        payload.adminGraphqlApiId ??
        payload.id;
  if (raw == null) return null;
  const value = String(raw);
  return value.startsWith("gid://shopify/Order/")
    ? value
    : `gid://shopify/Order/${value}`;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const webhookId =
    request.headers.get("X-Shopify-Webhook-Id") ?? crypto.randomUUID();
  const { admin, payload, shop, topic } =
    await authenticate.webhook(request);

  if (!admin) return new Response(null, { status: 200 });
  const data = payload as Record<string, unknown>;
  const id = orderGid(String(topic), data);
  if (!id) return new Response(null, { status: 200 });

  await syncSalesOrderFromAdmin({
    admin,
    sourceShop: shop,
    orderId: id,
    webhookId,
    topic: String(topic),
  });

  return new Response(null, { status: 200 });
};
