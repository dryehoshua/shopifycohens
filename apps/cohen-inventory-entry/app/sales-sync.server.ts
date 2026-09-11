import type {
  AdminApiContext,
} from "@shopify/shopify-app-react-router/server";
import type { Prisma } from "@prisma/client";
import db from "./db.server";
import { reconcileNekudotOrder } from "./nekudot.server";
import {
  nekudotPurchaseCentsForSyncedOrder,
  orderWatchdogStart,
  posSaleReferences,
} from "./sales-sync-domain";

type ShopifyMoney = {
  amount?: string | null;
  currencyCode?: string | null;
} | null;

// Shopify webhook and GraphQL payloads intentionally share this loose shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ShopifyOrder = Record<string, any>;

const ORDER_QUERY = `#graphql
  query ProfitOrder($id: ID!) {
    order(id: $id) {
      id
      name
      createdAt
      processedAt
      updatedAt
      cancelledAt
      currencyCode
      displayFinancialStatus
      displayFulfillmentStatus
      sourceName
      test
      customer { id }
      email
      phone
      customAttributes { key value }
      discountCodes
      currentSubtotalLineItemsQuantity
      currentSubtotalPriceSet {
        shopMoney { amount currencyCode }
      }
      currentTotalDiscountsSet {
        shopMoney { amount currencyCode }
      }
      currentTotalTaxSet {
        shopMoney { amount currencyCode }
      }
      currentTotalPriceSet {
        shopMoney { amount currencyCode }
      }
      totalRefundedSet {
        shopMoney { amount currencyCode }
      }
      lineItems(first: 250) {
        nodes {
          id
          name
          title
          variantTitle
          sku
          quantity
          currentQuantity
          originalUnitPriceSet {
            shopMoney { amount currencyCode }
          }
          originalTotalSet {
            shopMoney { amount currencyCode }
          }
          totalDiscountSet {
            shopMoney { amount currencyCode }
          }
          priceAfterAllDiscountsBeforeTaxesSet {
            shopMoney { amount currencyCode }
          }
          product {
            id
            handle
            title
          }
          variant {
            id
            title
            inventoryItem {
              id
              unitCost { amount currencyCode }
            }
          }
        }
      }
      refunds {
        id
        createdAt
        updatedAt
        totalRefundedSet {
          shopMoney { amount currencyCode }
        }
        refundLineItems(first: 250) {
          nodes {
            quantity
            subtotalSet {
              shopMoney { amount currencyCode }
            }
            lineItem { id }
          }
        }
        transactions(first: 50) {
          nodes {
            id
            kind
            status
            amountSet {
              shopMoney { amount currencyCode }
            }
          }
        }
      }
    }
  }
`;

const ORDER_IDS_QUERY = `#graphql
  query OrderWatchdog($first: Int!, $after: String, $query: String!) {
    orders(
      first: $first
      after: $after
      query: $query
      sortKey: UPDATED_AT
    ) {
      nodes {
        id
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const ORDER_WATCHDOG_SOURCE = "ORDER_WATCHDOG";
const ORDER_WATCHDOG_ITEM_SOURCE = "ORDER_WATCHDOG_ITEM";
const ORDER_WATCHDOG_PAGE_SIZE = 100;

function earliestDate(current: Date | null, candidate: Date) {
  return !current || candidate.getTime() < current.getTime()
    ? candidate
    : current;
}

function latestDate(current: Date | null, candidate: Date) {
  return !current || candidate.getTime() > current.getTime()
    ? candidate
    : current;
}

function moneyCents(money: ShopifyMoney) {
  if (money?.amount == null || money.amount === "") return 0;
  return Math.round(Number(money.amount) * 100);
}

function optionalMoneyCents(money: ShopifyMoney) {
  if (money?.amount == null || money.amount === "") return null;
  return Math.round(Number(money.amount) * 100);
}

function includedInProfit(order: ShopifyOrder) {
  if (order.test || order.cancelledAt) return false;
  return [
    "PAID",
    "PARTIALLY_PAID",
    "PARTIALLY_REFUNDED",
    "REFUNDED",
  ].includes(order.displayFinancialStatus ?? "");
}

function summarizeOrder(order: ShopifyOrder, costCapturedAt: Date) {
  const refundLinesByLineId = new Map<
    string,
    { quantity: number; subtotalCents: number }
  >();

  const refunds = order.refunds.map((refund: ShopifyOrder) => {
    let productSubtotalCents = 0;
    let productQuantity = 0;

    for (const refundLine of refund.refundLineItems.nodes) {
      const lineId = refundLine.lineItem.id as string;
      const subtotalCents = moneyCents(refundLine.subtotalSet?.shopMoney);
      const existing = refundLinesByLineId.get(lineId) ?? {
        quantity: 0,
        subtotalCents: 0,
      };
      existing.quantity += refundLine.quantity;
      existing.subtotalCents += subtotalCents;
      refundLinesByLineId.set(lineId, existing);
      productSubtotalCents += subtotalCents;
      productQuantity += refundLine.quantity;
    }

    const successfulTransactions = refund.transactions.nodes.filter(
      (transaction: ShopifyOrder) =>
        transaction.kind === "REFUND" && transaction.status === "SUCCESS",
    );
    const successfulAmountCents = successfulTransactions.reduce(
      (total: number, transaction: ShopifyOrder) =>
        total + moneyCents(transaction.amountSet?.shopMoney),
      0,
    );
    const transactionStates = [
      ...new Set<string>(
        refund.transactions.nodes.map(
          (transaction: ShopifyOrder) =>
            `${transaction.kind}:${transaction.status}`,
        ),
      ),
    ];

    return {
      shopifyRefundId: refund.id as string,
      createdAt: new Date(refund.createdAt),
      updatedAt: new Date(refund.updatedAt),
      successfulAmountCents,
      productSubtotalCents,
      productQuantity,
      transactionStatus:
        transactionStates.length > 0 ? transactionStates.join(",") : null,
      rawPayload: refund as Prisma.InputJsonValue,
    };
  });

  const lineItems = order.lineItems.nodes.map((line: ShopifyOrder) => {
    const originalUnitPriceCents = moneyCents(
      line.originalUnitPriceSet?.shopMoney,
    );
    const originalSalesCents =
      moneyCents(line.originalTotalSet?.shopMoney) ||
      originalUnitPriceCents * line.quantity;
    const netSalesCents = moneyCents(
      line.priceAfterAllDiscountsBeforeTaxesSet?.shopMoney,
    );
    const refund = refundLinesByLineId.get(line.id) ?? {
      quantity: Math.max(0, line.quantity - line.currentQuantity),
      subtotalCents: 0,
    };
    const directDiscountCents = moneyCents(
      line.totalDiscountSet?.shopMoney,
    );
    const derivedDiscountCents = Math.max(
      0,
      originalSalesCents - netSalesCents - refund.subtotalCents,
    );
    const discountCents = Math.max(
      directDiscountCents,
      derivedDiscountCents,
    );
    const unitCostMoney = line.variant?.inventoryItem?.unitCost as ShopifyMoney;
    const hasCurrentCost = unitCostMoney?.amount != null;
    const currentUnitCostCents = hasCurrentCost
      ? optionalMoneyCents(unitCostMoney)
      : null;
    const calculatedCostCents = hasCurrentCost
      ? (currentUnitCostCents ?? 0) * line.currentQuantity
      : null;
    const calculatedProfitCents =
      calculatedCostCents == null
        ? null
        : netSalesCents - calculatedCostCents;
    const marginBasisPoints =
      calculatedProfitCents == null || netSalesCents === 0
        ? null
        : Math.round((calculatedProfitCents / netSalesCents) * 10_000);

    return {
      shopifyLineItemId: line.id as string,
      shopifyProductId: (line.product?.id as string | undefined) ?? null,
      shopifyVariantId: (line.variant?.id as string | undefined) ?? null,
      shopifyInventoryItemId:
        (line.variant?.inventoryItem?.id as string | undefined) ?? null,
      productHandle:
        (line.product?.handle as string | undefined) ?? null,
      productTitle:
        (line.product?.title as string | undefined) ??
        line.title ??
        line.name,
      variantTitle:
        (line.variantTitle as string | undefined) ??
        (line.variant?.title as string | undefined) ??
        null,
      sku: (line.sku as string | undefined) || null,
      originalQuantity: line.quantity as number,
      netQuantity: line.currentQuantity as number,
      refundedQuantity: refund.quantity,
      originalUnitPriceCents,
      originalSalesCents,
      discountCents,
      refundedSalesCents: refund.subtotalCents,
      netSalesCents,
      currentUnitCostCents,
      calculatedCostCents,
      calculatedProfitCents,
      marginBasisPoints,
      costSource: hasCurrentCost
        ? "SHOPIFY_COST_PER_ITEM_CURRENT"
        : null,
      costCapturedAt: hasCurrentCost ? costCapturedAt : null,
      missingCostReason: hasCurrentCost
        ? null
        : line.variant
          ? "COST_PER_ITEM_EMPTY"
          : "VARIANT_DELETED_OR_CUSTOM_ITEM",
      rawPayload: line as Prisma.InputJsonValue,
    };
  });

  const sum = (
    field:
      | "originalSalesCents"
      | "netSalesCents"
      | "refundedSalesCents"
      | "discountCents"
      | "calculatedCostCents"
      | "calculatedProfitCents",
  ) =>
    lineItems.reduce(
      (total: number, line: ShopifyOrder) => total + (line[field] ?? 0),
      0,
    );
  const missingCostLines = lineItems.filter(
    (line: ShopifyOrder) =>
      line.currentUnitCostCents == null && line.netSalesCents !== 0,
  );
  const orderDiscountCents = moneyCents(
    order.currentTotalDiscountsSet?.shopMoney,
  );

  return {
    order: {
      shopifyOrderId: order.id as string,
      name: order.name as string,
      createdAt: new Date(order.createdAt),
      processedAt: order.processedAt
        ? new Date(order.processedAt)
        : null,
      shopifyUpdatedAt: new Date(order.updatedAt),
      importedAt: new Date(),
      cancelledAt: order.cancelledAt
        ? new Date(order.cancelledAt)
        : null,
      currencyCode: order.currencyCode as string,
      financialStatus:
        (order.displayFinancialStatus as string | undefined) ?? null,
      fulfillmentStatus:
        (order.displayFulfillmentStatus as string | undefined) ?? null,
      sourceName: (order.sourceName as string | undefined) ?? null,
      test: Boolean(order.test),
      includedInProfit: includedInProfit(order),
      originalSalesCents: sum("originalSalesCents"),
      discountCents: Math.max(
        orderDiscountCents,
        sum("discountCents"),
      ),
      refundedProductCents: sum("refundedSalesCents"),
      refundedPaymentCents: refunds.reduce(
        (total: number, refund: ShopifyOrder) =>
          total + refund.successfulAmountCents,
        0,
      ),
      netSalesCents: sum("netSalesCents"),
      taxCents: moneyCents(order.currentTotalTaxSet?.shopMoney),
      currentTotalCents: moneyCents(order.currentTotalPriceSet?.shopMoney),
      originalItemQuantity: lineItems.reduce(
        (total: number, line: ShopifyOrder) =>
          total + line.originalQuantity,
        0,
      ),
      netItemQuantity: lineItems.reduce(
        (total: number, line: ShopifyOrder) => total + line.netQuantity,
        0,
      ),
      calculableCostCents: sum("calculatedCostCents"),
      calculableProfitCents: sum("calculatedProfitCents"),
      coveredNetSalesCents: lineItems
        .filter((line: ShopifyOrder) => line.currentUnitCostCents != null)
        .reduce(
          (total: number, line: ShopifyOrder) =>
            total + line.netSalesCents,
          0,
        ),
      missingCostSalesCents: missingCostLines.reduce(
        (total: number, line: ShopifyOrder) =>
          total + line.netSalesCents,
        0,
      ),
      profitComplete: missingCostLines.length === 0,
      rawPayload: {
        currentSubtotalPriceSet: order.currentSubtotalPriceSet,
        totalRefundedSet: order.totalRefundedSet,
      } as Prisma.InputJsonValue,
    },
    lineItems,
    refunds,
    cashback: {
      customerId: (order.customer?.id as string | undefined) ?? null,
      customerEmail: (order.email as string | undefined) ?? null,
      customerPhone: (order.phone as string | undefined) ?? null,
      orderUpdatedAt: new Date(order.updatedAt),
      customAttributes: (order.customAttributes ?? []) as Array<{
        key: string;
        value: string;
      }>,
      discountCodes: (order.discountCodes ?? []) as string[],
      totalDiscountCents: orderDiscountCents,
    },
  };
}

async function persistOrder(
  sourceShop: string,
  summary: ReturnType<typeof summarizeOrder>,
  syncRunId: string,
) {
  const saleReferences = posSaleReferences(
    summary.cashback.customAttributes,
  );

  await db.$transaction(async (transaction) => {
    const storedOrder = await transaction.salesOrder.upsert({
      where: {
        sourceShop_shopifyOrderId: {
          sourceShop,
          shopifyOrderId: summary.order.shopifyOrderId,
        },
      },
      create: {
        ...summary.order,
        sourceShop,
        lastSyncRunId: syncRunId,
      },
      update: { ...summary.order, lastSyncRunId: syncRunId },
    });

    await transaction.salesLineItem.deleteMany({
      where: { orderId: storedOrder.id },
    });
    await transaction.salesRefund.deleteMany({
      where: { orderId: storedOrder.id },
    });
    if (summary.lineItems.length > 0) {
      await transaction.salesLineItem.createMany({
        data: summary.lineItems.map((lineItem: ShopifyOrder) => ({
          ...lineItem,
          orderId: storedOrder.id,
        })),
      });
    }
    if (summary.refunds.length > 0) {
      await transaction.salesRefund.createMany({
        data: summary.refunds.map((refund: ShopifyOrder) => ({
          ...refund,
          orderId: storedOrder.id,
        })),
      });
    }

    const linkedSale = {
      status: "SYNCED",
      shopifyOrderId: summary.order.shopifyOrderId,
      shopifyOrderName: summary.order.name,
      syncedAt: new Date(),
      errorMessage: null,
    };

    if (saleReferences.retailSaleId) {
      await transaction.retailSale.updateMany({
        where: {
          id: saleReferences.retailSaleId,
          shop: sourceShop,
          status: { notIn: ["REFUNDED"] },
        },
        data: linkedSale,
      });
    }

    if (saleReferences.cafeSaleId) {
      await transaction.cafeSale.updateMany({
        where: {
          id: saleReferences.cafeSaleId,
          shop: sourceShop,
          status: { notIn: ["REFUNDED", "CANCELLED"] },
        },
        data: linkedSale,
      });
    }

    for (const lineItem of summary.lineItems) {
      if (!lineItem.shopifyVariantId) continue;
      await transaction.productCostSnapshot.upsert({
        where: {
          syncRunId_shopifyVariantId: {
            syncRunId,
            shopifyVariantId: lineItem.shopifyVariantId,
          },
        },
        create: {
          sourceShop,
          shopifyProductId: lineItem.shopifyProductId,
          shopifyVariantId: lineItem.shopifyVariantId,
          shopifyInventoryItemId: lineItem.shopifyInventoryItemId,
          productHandle: lineItem.productHandle,
          productTitle: lineItem.productTitle,
          variantTitle: lineItem.variantTitle,
          sku: lineItem.sku,
          unitCostCents: lineItem.currentUnitCostCents,
          currencyCode: summary.order.currencyCode,
          capturedAt: lineItem.costCapturedAt ?? new Date(),
          syncRunId,
        },
        update: {
          unitCostCents: lineItem.currentUnitCostCents,
          capturedAt: lineItem.costCapturedAt ?? new Date(),
        },
      });
    }
  });
}

export async function syncSalesOrderFromAdmin({
  admin,
  sourceShop,
  orderId,
  webhookId,
  topic,
  syncSource,
}: {
  admin: AdminApiContext;
  sourceShop: string;
  orderId: string;
  webhookId: string;
  topic: string;
  syncSource?: string;
}) {
  const costCapturedAt = new Date();
  const syncRun = await db.salesSyncRun.create({
    data: {
      sourceShop,
      source: syncSource ?? `WEBHOOK_${topic}`,
      costCapturedAt,
      metadata: { webhookId, orderId, topic },
    },
  });

  try {
    const response = await admin.graphql(ORDER_QUERY, {
      variables: { id: orderId },
    });
    const payload = (await response.json()) as {
      data?: { order?: ShopifyOrder | null };
      errors?: Array<{ message?: string }>;
    };
    if (payload.errors?.length) {
      throw new Error(
        payload.errors
          .map((error) => error.message ?? "Error GraphQL")
          .join("; "),
      );
    }

    if (!payload.data?.order) {
      await db.salesSyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          metadata: {
            webhookId,
            orderId,
            topic,
            orderNotFound: true,
          },
        },
      });
      return {
        imported: false,
        lineItemsSeen: 0,
        refundsSeen: 0,
        orderCreatedAt: null,
      };
    }

    const summary = summarizeOrder(payload.data.order, costCapturedAt);
    await persistOrder(sourceShop, summary, syncRun.id);
    await reconcileNekudotOrder({
      shop: sourceShop,
      shopifyOrderId: summary.order.shopifyOrderId,
      orderName: summary.order.name,
      customerId: summary.cashback.customerId,
      customerEmail: summary.cashback.customerEmail,
      customerPhone: summary.cashback.customerPhone,
      currencyCode: summary.order.currencyCode,
      eligibleFinancialStatus: summary.order.includedInProfit,
      cancelled: Boolean(summary.order.cancelledAt),
      orderUpdatedAt: summary.cashback.orderUpdatedAt,
      purchaseCents: nekudotPurchaseCentsForSyncedOrder({
        currentTotalCents: summary.order.currentTotalCents,
        lineNetSalesCents: summary.lineItems.map(
          (lineItem: ShopifyOrder) => lineItem.netSalesCents,
        ),
        customAttributes: summary.cashback.customAttributes,
      }),
      customAttributes: summary.cashback.customAttributes,
      discountCodes: summary.cashback.discountCodes,
      totalDiscountCents: summary.cashback.totalDiscountCents,
    });
    await db.salesSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        ordersSeen: 1,
        ordersImported: 1,
        lineItemsSeen: summary.lineItems.length,
        refundsSeen: summary.refunds.length,
        oldestOrderAt: summary.order.createdAt,
        newestOrderAt: summary.order.createdAt,
      },
    });

    return {
      imported: true,
      lineItemsSeen: summary.lineItems.length,
      refundsSeen: summary.refunds.length,
      orderCreatedAt: summary.order.createdAt,
    };
  } catch (error) {
    await db.salesSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage:
          error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

export async function syncRecentSalesOrdersFromAdmin({
  admin,
  sourceShop,
  now = new Date(),
  overlapMinutes = 2,
  initialLookbackMinutes = 7 * 24 * 60,
}: {
  admin: AdminApiContext;
  sourceShop: string;
  now?: Date;
  overlapMinutes?: number;
  initialLookbackMinutes?: number;
}) {
  const previousRun = await db.salesSyncRun.findFirst({
    where: {
      sourceShop,
      source: ORDER_WATCHDOG_SOURCE,
      status: "COMPLETED",
      completedAt: { not: null },
    },
    orderBy: { completedAt: "desc" },
  });
  const since = orderWatchdogStart({
    now,
    lastCompletedAt: previousRun?.completedAt,
    overlapMinutes,
    initialLookbackMinutes,
  });
  const syncRun = await db.salesSyncRun.create({
    data: {
      sourceShop,
      source: ORDER_WATCHDOG_SOURCE,
      costCapturedAt: now,
      metadata: {
        since: since.toISOString(),
        intervalSeconds: 60,
        overlapMinutes,
      },
    },
  });
  const orderIds = new Set<string>();
  const failures: Array<{ orderId: string; message: string }> = [];
  let after: string | null = null;
  let pages = 0;
  let ordersSeen = 0;
  let ordersImported = 0;
  let lineItemsSeen = 0;
  let refundsSeen = 0;
  let oldestOrderAt: Date | null = null;
  let newestOrderAt: Date | null = null;

  try {
    do {
      pages += 1;
      if (pages > 100) {
        throw new Error("El watchdog excedió 100 páginas de pedidos.");
      }

      const response = await admin.graphql(ORDER_IDS_QUERY, {
        variables: {
          first: ORDER_WATCHDOG_PAGE_SIZE,
          after,
          query: `updated_at:>='${since.toISOString()}'`,
        },
      });
      const payload = (await response.json()) as {
        data?: {
          orders?: {
            nodes: Array<{ id: string }>;
            pageInfo: {
              hasNextPage: boolean;
              endCursor: string | null;
            };
          };
        };
        errors?: Array<{ message?: string }>;
      };
      if (payload.errors?.length) {
        throw new Error(
          payload.errors
            .map((error) => error.message ?? "Error GraphQL")
            .join("; "),
        );
      }
      if (!payload.data?.orders) {
        throw new Error("Shopify no devolvió la lista de pedidos.");
      }

      for (const order of payload.data.orders.nodes) {
        if (orderIds.has(order.id)) continue;
        orderIds.add(order.id);
        ordersSeen += 1;
        try {
          const result = await syncSalesOrderFromAdmin({
            admin,
            sourceShop,
            orderId: order.id,
            webhookId: `watchdog:${syncRun.id}:${order.id}`,
            topic: "watchdog",
            syncSource: ORDER_WATCHDOG_ITEM_SOURCE,
          });
          if (!result.imported || !result.orderCreatedAt) continue;
          ordersImported += 1;
          lineItemsSeen += result.lineItemsSeen;
          refundsSeen += result.refundsSeen;
          oldestOrderAt = earliestDate(
            oldestOrderAt,
            result.orderCreatedAt,
          );
          newestOrderAt = latestDate(
            newestOrderAt,
            result.orderCreatedAt,
          );
        } catch (error) {
          failures.push({
            orderId: order.id,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      after = payload.data.orders.pageInfo.endCursor;
      if (!payload.data.orders.pageInfo.hasNextPage) break;
      if (!after) {
        throw new Error("Shopify indicó otra página sin cursor.");
      }
    } while (after);

    const completedAt = new Date();
    await db.salesSyncRun.update({
      where: { id: syncRun.id },
      data: {
        status: failures.length > 0 ? "FAILED" : "COMPLETED",
        completedAt,
        ordersSeen,
        ordersImported,
        lineItemsSeen,
        refundsSeen,
        oldestOrderAt,
        newestOrderAt,
        errorMessage:
          failures.length > 0
            ? `${failures.length} pedido(s) no pudieron sincronizarse.`
            : null,
        metadata: {
          since: since.toISOString(),
          completedAt: completedAt.toISOString(),
          intervalSeconds: 60,
          overlapMinutes,
          pages,
          failures: failures.slice(0, 20),
        },
      },
    });

    if (failures.length > 0) {
      throw new Error(
        `El watchdog no pudo sincronizar ${failures.length} pedido(s).`,
      );
    }

    return {
      syncRunId: syncRun.id,
      sourceShop,
      since,
      completedAt,
      pages,
      ordersSeen,
      ordersImported,
      lineItemsSeen,
      refundsSeen,
    };
  } catch (error) {
    const failedRun = await db.salesSyncRun.findUnique({
      where: { id: syncRun.id },
      select: { completedAt: true },
    });
    if (!failedRun?.completedAt) {
      await db.salesSyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          ordersSeen,
          ordersImported,
          lineItemsSeen,
          refundsSeen,
          oldestOrderAt,
          newestOrderAt,
          errorMessage:
            error instanceof Error ? error.message : String(error),
          metadata: {
            since: since.toISOString(),
            intervalSeconds: 60,
            overlapMinutes,
            pages,
            failures: failures.slice(0, 20),
          },
        },
      });
    }
    throw error;
  }
}
