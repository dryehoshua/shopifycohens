import type { LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import {
  domainErrorResponse,
  shopDomainFromDestination,
  toLocationGid,
} from "../inventory.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { sessionToken, cors } = await authenticate.pos(request);

  try {
    const url = new URL(request.url);
    const shop = shopDomainFromDestination(sessionToken.dest);
    const locationParam = url.searchParams.get("locationId");
    const locationId = locationParam ? toLocationGid(locationParam) : undefined;
    const requestedLimit = Number(url.searchParams.get("limit") || "10");
    const take = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 50)
      : 10;

    const movements = await db.inventoryMovement.findMany({
      where: {
        shop,
        status: "COMMITTED",
        ...(locationId ? { locationId } : {}),
      },
      orderBy: { occurredAt: "desc" },
      take,
      include: {
        reversal: {
          select: {
            id: true,
            status: true,
            occurredAt: true,
          },
        },
      },
    });

    return cors(
      Response.json({
        ok: true,
        movements: movements.map((movement) => ({
          id: movement.id,
          type: movement.type,
          status: movement.status,
          occurredAt: movement.occurredAt.toISOString(),
          barcode: movement.barcode,
          sku: movement.sku,
          productTitle: movement.productTitle,
          variantTitle: movement.variantTitle,
          quantityDelta: movement.quantityDelta,
          beforeAvailable: movement.beforeAvailable,
          afterAvailable: movement.afterAvailable,
          supplier: movement.supplier,
          note: movement.note,
          reversalOfId: movement.reversalOfId,
          reversedBy: movement.reversal
            ? {
                id: movement.reversal.id,
                status: movement.reversal.status,
                occurredAt: movement.reversal.occurredAt.toISOString(),
              }
            : null,
        })),
      }),
    );
  } catch (error) {
    return cors(domainErrorResponse(error));
  }
};
