import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import db from "./db.server";
import {
  classifyMovementEvidence,
  matchAuditEventToMovement,
  reconciliationFingerprint,
  type AdjustmentGroupEvidence,
} from "./inventory-reconciliation-domain";

type GraphqlError = { message?: string };

type CatalogEvidence = {
  id: string;
  sku: string | null;
  variant: {
    id: string;
    title: string;
    barcode: string | null;
    product: { id: string; title: string };
  };
  inventoryLevels: {
    nodes: Array<{
      location: { id: string; name: string };
      quantities: Array<{ name: string; quantity: number }>;
    }>;
  };
};

type EvidenceNode = AdjustmentGroupEvidence | CatalogEvidence | null;

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function graphqlNodes(
  admin: AdminApiContext,
  ids: string[],
  kind: "adjustments" | "items",
) {
  const nodes: EvidenceNode[] = [];
  // Cada InventoryItem puede solicitar hasta 100 InventoryLevels. Cinco artículos
  // mantienen el costo solicitado por debajo del máximo de 1,000 puntos de Shopify.
  const chunkSize = kind === "items" ? 5 : 75;
  for (const idChunk of chunks(Array.from(new Set(ids)), chunkSize)) {
    if (!idChunk.length) continue;
    const query =
      kind === "adjustments"
        ? `#graphql
          query CohenInventoryAdjustmentEvidence($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on InventoryAdjustmentGroup {
                id
                createdAt
                reason
                referenceDocumentUri
                changes {
                  name
                  delta
                  quantityAfterChange
                  item { id }
                  location { id name }
                }
              }
            }
          }`
        : `#graphql
          query CohenInventoryItemEvidence($ids: [ID!]!) {
            nodes(ids: $ids) {
              ... on InventoryItem {
                id
                sku
                variant { id title barcode product { id title } }
                inventoryLevels(first: 100, includeInactive: false) {
                  nodes {
                    location { id name }
                    quantities(names: ["available", "committed", "on_hand"]) {
                      name
                      quantity
                    }
                  }
                }
              }
            }
          }`;
    let response: Response;
    try {
      response = await admin.graphql(query, { variables: { ids: idChunk } });
    } catch (error) {
      const graphQLErrors = (
        error as { errors?: { graphQLErrors?: Array<{ message?: string }> } }
      ).errors?.graphQLErrors;
      const detail = graphQLErrors
        ?.map((graphQLError) => graphQLError.message)
        .filter(Boolean)
        .join("; ");
      throw new Error(
        `Shopify rechazó la consulta de evidencia ${kind}: ${
          detail || (error instanceof Error ? error.message : "error desconocido")
        }`,
      );
    }
    const payload = (await response.json()) as {
      data?: { nodes?: EvidenceNode[] };
      errors?: GraphqlError[];
    };
    const errors = payload.errors?.map((error) => error.message).filter(Boolean) ?? [];
    if (errors.length) throw new Error(errors.join("; "));
    nodes.push(...(payload.data?.nodes ?? []));
  }
  return nodes;
}

function isAdjustmentGroup(node: EvidenceNode): node is AdjustmentGroupEvidence {
  return Boolean(node && "referenceDocumentUri" in node && "changes" in node);
}

function isCatalogEvidence(node: EvidenceNode): node is CatalogEvidence {
  return Boolean(node && "inventoryLevels" in node && "variant" in node);
}

function availableAt(item: CatalogEvidence | undefined, locationId: string | null) {
  if (!item || !locationId) return { quantity: null, locationName: null };
  const level = item.inventoryLevels.nodes.find((entry) => entry.location.id === locationId);
  return {
    quantity:
      level?.quantities.find((quantity) => quantity.name === "available")?.quantity ?? null,
    locationName: level?.location.name ?? null,
  };
}

async function upsertIssue(input: {
  fingerprint: string;
  shop: string;
  kind: string;
  severity: string;
  source: string;
  occurredAt?: Date | null;
  locationId?: string | null;
  locationName?: string | null;
  inventoryItemId?: string | null;
  productId?: string | null;
  variantId?: string | null;
  productTitle?: string | null;
  variantTitle?: string | null;
  sku?: string | null;
  barcode?: string | null;
  quantityDelta?: number | null;
  expectedAvailable?: number | null;
  actualAvailable?: number | null;
  movementId?: string | null;
  auditEventId?: string | null;
  localRecordType?: string | null;
  localRecordId?: string | null;
  summary: string;
  detail: string;
  metadata?: Prisma.InputJsonValue;
}) {
  const data = {
    ...input,
    status: "OPEN",
    reviewedAt: null,
    reviewedBy: null,
    reviewNote: null,
  };
  return db.inventoryReconciliationIssue.upsert({
    where: { fingerprint: input.fingerprint },
    create: data,
    update: data,
  });
}

export type ReconciliationOptions = {
  source: "MANUAL" | "SCHEDULED";
  triggerKey?: string;
};

export async function runInventoryReconciliation(
  admin: AdminApiContext,
  shop: string,
  options: ReconciliationOptions,
) {
  const triggerKey = options.triggerKey?.trim() || `${options.source.toLowerCase()}:${randomUUID()}`;
  const existing = await db.inventoryReconciliationRun.findUnique({
    where: { shop_triggerKey: { shop, triggerKey } },
  });
  if (existing) return existing;

  const run = await db.inventoryReconciliationRun.create({
    data: { shop, triggerKey, source: options.source },
  });

  try {
    const [movements, auditEvents, pendingRetailSales, pendingCafeSales] =
      await Promise.all([
        db.inventoryMovement.findMany({ where: { shop }, orderBy: { occurredAt: "asc" } }),
        db.inventoryAuditEvent.findMany({
          where: { shop },
          orderBy: { capturedAt: "asc" },
        }),
        db.retailSale.findMany({ where: { shop, status: "PENDING_SYNC" } }),
        db.cafeSale.findMany({ where: { shop, status: "PENDING_SYNC" } }),
      ]);

    // Shopify may persist topic names with either slash/case representation.
    const inventoryEvents = auditEvents.filter((event) =>
      event.topic.toLowerCase().replaceAll("_", "/").includes("inventory/levels"),
    );

    const groupNodes = await graphqlNodes(
      admin,
      movements
        .map((movement) => movement.shopifyAdjustmentGroupId)
        .filter((id): id is string => Boolean(id)),
      "adjustments",
    );
    const groups = new Map(
      groupNodes.filter(isAdjustmentGroup).map((group) => [group.id, group]),
    );

    const itemIds = Array.from(
      new Set([
        ...movements.map((movement) => movement.inventoryItemId),
        ...inventoryEvents
          .map((event) => event.inventoryItemId)
          .filter((id): id is string => Boolean(id)),
      ]),
    );
    const itemNodes = await graphqlNodes(admin, itemIds, "items");
    const catalog = new Map(
      itemNodes.filter(isCatalogEvidence).map((item) => [item.id, item]),
    );

    let matched = 0;
    let uncertain = 0;
    for (const movement of movements) {
      if (movement.status !== "COMMITTED") {
        uncertain += 1;
        await db.inventoryMovement.update({
          where: { id: movement.id },
          data: {
            reconciliationStatus: "UNKNOWN",
            reconciledAt: new Date(),
            reconciliationError: movement.errorMessage || "Movimiento sin confirmación terminal.",
          },
        });
        await upsertIssue({
          fingerprint: reconciliationFingerprint(["movement", movement.id, "uncertain"]),
          shop,
          kind: "MOVEMENT_UNCERTAIN",
          severity: "CRITICAL",
          source: "COHENS_OPERATIONS",
          occurredAt: movement.occurredAt,
          locationId: movement.locationId,
          inventoryItemId: movement.inventoryItemId,
          productId: movement.productId,
          variantId: movement.variantId,
          productTitle: movement.productTitle,
          variantTitle: movement.variantTitle,
          sku: movement.sku,
          barcode: movement.barcode,
          quantityDelta: movement.quantityDelta,
          expectedAvailable: movement.afterAvailable,
          actualAvailable: availableAt(catalog.get(movement.inventoryItemId), movement.locationId).quantity,
          movementId: movement.id,
          summary: `Movimiento ${movement.status.toLowerCase()} pendiente de conciliación`,
          detail: "Reintenta el mismo folio para que Shopify devuelva el resultado idempotente; no registres otra entrada.",
        });
        continue;
      }

      const evidence = classifyMovementEvidence(
        movement,
        movement.shopifyAdjustmentGroupId
          ? groups.get(movement.shopifyAdjustmentGroupId) ?? null
          : null,
      );
      if (evidence.status === "MATCHED") {
        matched += 1;
        await Promise.all([
          db.inventoryMovement.update({
            where: { id: movement.id },
            data: {
              reconciliationStatus: "MATCHED",
              reconciledAt: new Date(),
              reconciliationError: null,
              ...(evidence.quantityAfterChange === null
                ? {}
                : { afterAvailable: evidence.quantityAfterChange }),
            },
          }),
          db.inventoryReconciliationIssue.updateMany({
            where: {
              movementId: movement.id,
              status: "OPEN",
              kind: { in: ["MISSING_SHOPIFY", "EVIDENCE_MISMATCH", "MOVEMENT_UNCERTAIN"] },
            },
            data: { status: "RESOLVED" },
          }),
        ]);
        continue;
      }

      const current = availableAt(catalog.get(movement.inventoryItemId), movement.locationId);
      await db.inventoryMovement.update({
        where: { id: movement.id },
        data: {
          reconciliationStatus: evidence.status,
          reconciledAt: new Date(),
          reconciliationError: evidence.reason,
        },
      });
      await upsertIssue({
        fingerprint: reconciliationFingerprint(["movement", movement.id, evidence.status]),
        shop,
        kind: evidence.status,
        severity: "CRITICAL",
        source: "SHOPIFY_EVIDENCE",
        occurredAt: movement.occurredAt,
        locationId: movement.locationId,
        locationName: current.locationName,
        inventoryItemId: movement.inventoryItemId,
        productId: movement.productId,
        variantId: movement.variantId,
        productTitle: movement.productTitle,
        variantTitle: movement.variantTitle,
        sku: movement.sku,
        barcode: movement.barcode,
        quantityDelta: movement.quantityDelta,
        expectedAvailable: movement.afterAvailable,
        actualAvailable: current.quantity,
        movementId: movement.id,
        summary:
          evidence.status === "MISSING_SHOPIFY"
            ? "Movimiento local sin evidencia Shopify"
            : "La evidencia Shopify no coincide",
        detail: evidence.reason,
      });
    }

    const movementCandidates = movements.map((movement) => ({
      id: movement.id,
      inventoryItemId: movement.inventoryItemId,
      locationId: movement.locationId,
      occurredAt: movement.occurredAt,
      afterAvailable: movement.afterAvailable,
    }));
    const externalByPair = new Map<string, typeof inventoryEvents>();
    for (const event of inventoryEvents) {
      if (!event.inventoryItemId || !event.locationId) continue;
      if (matchAuditEventToMovement(event, movementCandidates)) continue;
      const pair = `${event.inventoryItemId}|${event.locationId}`;
      const values = externalByPair.get(pair) ?? [];
      values.push(event);
      externalByPair.set(pair, values);
    }

    for (const [pair, events] of externalByPair) {
      const [inventoryItemId, locationId] = pair.split("|");
      const latest = events[events.length - 1];
      const item = catalog.get(inventoryItemId);
      const variant = item?.variant;
      const current = availableAt(item, locationId);
      const relatedMovement = movements
        .filter(
          (movement) =>
            movement.inventoryItemId === inventoryItemId && movement.locationId === locationId,
        )
        .at(-1);
      await upsertIssue({
        fingerprint: reconciliationFingerprint(["external", shop, inventoryItemId, locationId]),
        shop,
        kind: "EXTERNAL_CHANGE",
        severity: "INFO",
        source: "SHOPIFY_WEBHOOK",
        occurredAt: latest.occurredAt ?? latest.capturedAt,
        locationId,
        locationName: current.locationName,
        inventoryItemId,
        productId: variant?.product.id ?? relatedMovement?.productId ?? null,
        variantId: variant?.id ?? relatedMovement?.variantId ?? null,
        productTitle: variant?.product.title ?? relatedMovement?.productTitle ?? null,
        variantTitle: variant?.title ?? relatedMovement?.variantTitle ?? null,
        sku: item?.sku ?? relatedMovement?.sku ?? null,
        barcode: variant?.barcode ?? relatedMovement?.barcode ?? null,
        actualAvailable: current.quantity,
        auditEventId: latest.id,
        summary: "Cambio de inventario originado fuera del módulo de entradas",
        detail: `${events.length} evento(s) no corresponden a una recepción local. Puede tratarse de venta, devolución, preparación o ajuste manual; requiere revisión sólo si el conteo físico no coincide.`,
        metadata: { eventCount: events.length, latestWebhookId: latest.webhookId },
      });
    }

    for (const sale of [...pendingRetailSales, ...pendingCafeSales]) {
      const recordType = "grossCents" in sale ? "RETAIL_SALE" : "CAFE_SALE";
      await upsertIssue({
        fingerprint: reconciliationFingerprint(["sale", recordType, sale.id]),
        shop,
        kind: "SALE_PENDING_SYNC",
        severity: "CRITICAL",
        source: "COHENS_POS",
        occurredAt: sale.createdAt,
        localRecordType: recordType,
        localRecordId: sale.id,
        summary: "Venta local pendiente de sincronizar con Shopify",
        detail: `Folio ${sale.id}. Reintenta la venta existente; no vuelvas a cobrar ni crees un pedido manual.`,
      });
    }

    const openIssues = await db.inventoryReconciliationIssue.count({
      where: { shop, status: "OPEN" },
    });
    return db.inventoryReconciliationRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        movementsExamined: movements.length,
        movementsMatched: matched,
        externalChanges: externalByPair.size,
        uncertainMovements: uncertain,
        pendingSales: pendingRetailSales.length + pendingCafeSales.length,
        openIssues,
        metadata: {
          auditEventsExamined: inventoryEvents.length,
          inventoryItemsExamined: itemIds.length,
        },
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    await db.inventoryReconciliationRun.update({
      where: { id: run.id },
      data: { status: "FAILED", completedAt: new Date(), errorMessage: message.slice(0, 2000) },
    });
    throw error;
  }
}
