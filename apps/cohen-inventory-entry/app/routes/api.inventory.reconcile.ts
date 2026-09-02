import { timingSafeEqual } from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { runInventoryReconciliation } from "../inventory-reconciliation.server";
import { unauthenticated } from "../shopify.server";

function authorized(request: Request) {
  const configured = process.env.INVENTORY_RECONCILIATION_SECRET || "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!configured || configured.length !== supplied.length) return false;
  return timingSafeEqual(Buffer.from(configured), Buffer.from(supplied));
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Método no permitido." }, { status: 405 });
  }
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "No autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as { shop?: unknown; date?: unknown };
  const requestedShop = typeof body.shop === "string" ? body.shop.trim() : "";
  const date = typeof body.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
    ? body.date
    : new Date().toISOString().slice(0, 10);
  const shops = requestedShop
    ? [requestedShop]
    : (await db.session.findMany({
        where: { isOnline: false },
        distinct: ["shop"],
        select: { shop: true },
      })).map((session) => session.shop);

  const results: Array<{
    shop: string;
    runId?: string;
    status: string;
    openIssues?: number;
    error?: string;
  }> = [];
  for (const shop of shops) {
    try {
      const { admin } = await unauthenticated.admin(shop);
      const run = await runInventoryReconciliation(admin, shop, {
        source: "SCHEDULED",
        triggerKey: `daily:${date}`,
      });
      results.push({ shop, runId: run.id, status: run.status, openIssues: run.openIssues });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido";
      console.error(`[inventory-reconciliation] ${shop}: ${message}`, error);
      results.push({ shop, status: "FAILED", error: message.slice(0, 2_000) });
    }
  }
  const failed = results.filter((result) => result.status === "FAILED");
  return Response.json(
    { ok: failed.length === 0, date, results },
    { status: failed.length === 0 ? 200 : 500 },
  );
};
