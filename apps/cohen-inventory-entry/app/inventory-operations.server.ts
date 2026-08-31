import type { InventoryMovement } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import db from "./db.server";
import {
  adjustAvailableQuantity,
  getAvailableQuantity,
  InventoryDomainError,
  lookupVariantByBarcode,
  normalizeBarcode,
  normalizeIdempotencyKey,
  normalizeOptionalText,
  normalizePositiveInteger,
  toLocationGid,
} from "./inventory.server";
import { resolveSupplier } from "./supplier.server";
import { isTransientInventoryFailure } from "./inventory-reconciliation-domain";

export type InventoryActor = {
  userId?: unknown;
  staffMemberId?: unknown;
  deviceId?: unknown;
};

export type ReceiveInventoryInput = {
  barcode?: unknown;
  quantity?: unknown;
  idempotencyKey?: unknown;
  locationId?: unknown;
  supplierId?: unknown;
  newSupplier?: unknown;
  supplier?: unknown;
  note?: unknown;
};

export type ReverseInventoryInput = {
  idempotencyKey?: unknown;
  note?: unknown;
};

export function identityValue(value: unknown) {
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

export function movementJson(movement: InventoryMovement, idempotent = false) {
  return {
    id: movement.id,
    type: movement.type,
    status: movement.status,
    occurredAt: movement.occurredAt.toISOString(),
    barcode: movement.barcode,
    sku: movement.sku,
    productId: movement.productId,
    productTitle: movement.productTitle,
    variantId: movement.variantId,
    variantTitle: movement.variantTitle,
    inventoryItemId: movement.inventoryItemId,
    locationId: movement.locationId,
    quantityDelta: movement.quantityDelta,
    beforeAvailable: movement.beforeAvailable,
    afterAvailable: movement.afterAvailable,
    supplier: movement.supplier,
    supplierRecordId: movement.supplierRecordId,
    note: movement.note,
    referenceDocumentUri: movement.referenceDocumentUri,
    reversalOfId: movement.reversalOfId,
    idempotent,
  };
}

function pendingRequestMatches(
  movement: InventoryMovement,
  input: { barcode: string; quantity: number; locationId: string },
) {
  return (
    movement.barcode === input.barcode &&
    movement.quantityDelta === input.quantity &&
    movement.locationId === input.locationId &&
    movement.type === "RECEIPT"
  );
}

export async function receiveInventory(
  admin: AdminApiContext,
  shop: string,
  input: ReceiveInventoryInput,
  actor: InventoryActor = {},
) {
  const barcode = normalizeBarcode(input.barcode);
  const quantity = normalizePositiveInteger(input.quantity);
  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const locationId = toLocationGid(input.locationId);
  const note = normalizeOptionalText(input.note, 500);
  const userId = identityValue(actor.userId);
  const staffMemberId = identityValue(actor.staffMemberId);
  const deviceId = identityValue(actor.deviceId);

  let movement = await db.inventoryMovement.findUnique({
    where: { idempotencyKey },
  });

  if (movement) {
    if (movement.shop !== shop) {
      throw new InventoryDomainError(
        "La clave de operación ya pertenece a otra tienda.",
        { status: 409, code: "IDEMPOTENCY_KEY_CONFLICT" },
      );
    }
    if (!pendingRequestMatches(movement, { barcode, quantity, locationId })) {
      throw new InventoryDomainError(
        "La clave de operación ya se utilizó con otros datos.",
        { status: 409, code: "IDEMPOTENCY_PAYLOAD_CONFLICT" },
      );
    }
    if (movement.status === "COMMITTED") {
      return { movement: movementJson(movement, true), created: false };
    }
    if (movement.status === "FAILED") {
      throw new InventoryDomainError(
        movement.errorMessage ||
          "Esta operación falló anteriormente. Inicia un nuevo registro.",
        { status: 409, code: "PREVIOUS_ATTEMPT_FAILED" },
      );
    }
    // PENDING y RECONCILING se reenvían con la misma clave. Shopify garantiza
    // que @idempotent devuelve el primer resultado sin aplicar otro ajuste.
  } else {
    const [variant, supplierRecord] = await Promise.all([
      lookupVariantByBarcode(admin, barcode, locationId),
      resolveSupplier(shop, {
        supplierId: input.supplierId,
        newSupplier: input.newSupplier,
        supplier: input.supplier,
      }),
    ]);
    const supplier = supplierRecord.name;
    const occurredAt = new Date();
    const referenceDocumentUri = `cohen-inventory://receipt/${idempotencyKey}`;
    const requestPayload = {
      source: deviceId === "desktop-admin" ? "ADMIN_DESKTOP" : "SHOPIFY_POS",
      occurredAt: occurredAt.toISOString(),
      barcode,
      quantity,
      locationId,
      supplier,
      supplierRecordId: supplierRecord.id,
      note,
      userId,
      staffMemberId,
      deviceId,
    };

    try {
      movement = await db.inventoryMovement.create({
        data: {
          shop,
          idempotencyKey,
          type: "RECEIPT",
          status: "PENDING",
          occurredAt,
          userId,
          staffMemberId,
          locationId,
          deviceId,
          barcode: variant.barcode,
          sku: variant.sku,
          productId: variant.productId,
          productTitle: variant.productTitle,
          variantId: variant.variantId,
          variantTitle: variant.variantTitle,
          inventoryItemId: variant.inventoryItemId,
          quantityDelta: quantity,
          reason: "received",
          supplier,
          supplierRecordId: supplierRecord.id,
          note,
          beforeAvailable: variant.available,
          afterAvailable: null,
          referenceDocumentUri,
          requestPayload,
        },
      });
    } catch (error) {
      movement = await db.inventoryMovement.findUnique({
        where: { idempotencyKey },
      });
      if (!movement) throw error;
    }
  }

  if (movement.beforeAvailable === null) {
    throw new InventoryDomainError(
      "No existe una existencia inicial para completar la operación.",
      { status: 409, code: "STARTING_QUANTITY_MISSING" },
    );
  }

  let adjustment;
  try {
    adjustment = await adjustAvailableQuantity(admin, {
      inventoryItemId: movement.inventoryItemId,
      locationId: movement.locationId,
      delta: movement.quantityDelta,
      changeFromQuantity: movement.beforeAvailable,
      reason: "received",
      referenceDocumentUri: movement.referenceDocumentUri,
      idempotencyKey: movement.idempotencyKey,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Shopify rechazó el ajuste.";
    const transient = isTransientInventoryFailure(error);
    await db.inventoryMovement.updateMany({
      where: { id: movement.id, status: { in: ["PENDING", "RECONCILING"] } },
      data: {
        status: transient ? "RECONCILING" : "FAILED",
        reconciliationStatus: transient ? "UNKNOWN" : "NEEDS_REVIEW",
        reconciliationError: message,
        errorMessage: message,
        responsePayload:
          error instanceof InventoryDomainError && error.details
            ? { details: error.details }
            : undefined,
      },
    });
    if (transient) {
      throw new InventoryDomainError(
        "Shopify no confirmó la respuesta. Vuelve a pulsar Registrar con los mismos datos; el folio se recuperará sin duplicar unidades.",
        {
          status: 503,
          code: "INVENTORY_RECONCILING",
          details: { movementId: movement.id, idempotencyKey: movement.idempotencyKey },
        },
      );
    }
    throw error;
  }

  const availableChange = adjustment.group.changes.find(
    (change) => change.name === "available" && change.delta === movement.quantityDelta,
  );

  const committed = await db.inventoryMovement.update({
    where: { id: movement.id },
    data: {
      status: "COMMITTED",
      afterAvailable:
        availableChange?.quantityAfterChange ??
        movement.beforeAvailable + movement.quantityDelta,
      shopifyAdjustmentGroupId: adjustment.group.id || null,
      shopifyAdjustmentAt: new Date(adjustment.group.createdAt),
      shopifyAdjustmentReason: adjustment.group.reason,
      responsePayload: adjustment.raw,
      errorMessage: null,
      reconciliationStatus: "MATCHED",
      reconciledAt: new Date(),
      reconciliationError: null,
    },
  });

  return { movement: movementJson(committed), created: true };
}

export async function reverseInventory(
  admin: AdminApiContext,
  shop: string,
  movementId: string,
  input: ReverseInventoryInput,
  actor: InventoryActor = {},
) {
  if (!movementId) {
    throw new InventoryDomainError("No se indicó el movimiento a corregir.", {
      status: 400,
      code: "MOVEMENT_REQUIRED",
    });
  }

  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const note = normalizeOptionalText(input.note, 500);
  if (!note) {
    throw new InventoryDomainError(
      "Escribe el motivo de la corrección para conservar la evidencia.",
      { status: 400, code: "REVERSAL_NOTE_REQUIRED" },
    );
  }
  const userId = identityValue(actor.userId);
  const staffMemberId = identityValue(actor.staffMemberId);
  const deviceId = identityValue(actor.deviceId);

  const original = await db.inventoryMovement.findFirst({
    where: { id: movementId, shop },
    include: { reversal: true },
  });
  if (!original || original.status !== "COMMITTED") {
    throw new InventoryDomainError(
      "La entrada original no existe o no está confirmada.",
      { status: 404, code: "MOVEMENT_NOT_FOUND" },
    );
  }
  if (original.type !== "RECEIPT") {
    throw new InventoryDomainError(
      "Solo se puede revertir una entrada confirmada.",
      { status: 409, code: "MOVEMENT_NOT_REVERSIBLE" },
    );
  }
  if (original.reversal?.status === "COMMITTED") {
    throw new InventoryDomainError(
      "Esta entrada ya fue corregida mediante un movimiento inverso.",
      {
        status: 409,
        code: "MOVEMENT_ALREADY_REVERSED",
        details: { reversalId: original.reversal.id },
      },
    );
  }

  let reversal = await db.inventoryMovement.findUnique({
    where: { idempotencyKey },
  });
  if (reversal) {
    if (
      reversal.shop !== shop ||
      reversal.reversalOfId !== original.id ||
      reversal.type !== "REVERSAL"
    ) {
      throw new InventoryDomainError(
        "La clave de operación ya se utilizó con otros datos.",
        { status: 409, code: "IDEMPOTENCY_PAYLOAD_CONFLICT" },
      );
    }
    if (reversal.status === "COMMITTED") {
      return { movement: movementJson(reversal, true), created: false };
    }
    if (reversal.status === "FAILED") {
      throw new InventoryDomainError(
        reversal.errorMessage ||
          "La corrección falló anteriormente. Inicia un nuevo intento.",
        { status: 409, code: "PREVIOUS_ATTEMPT_FAILED" },
      );
    }
  } else {
    const beforeAvailable = await getAvailableQuantity(
      admin,
      original.inventoryItemId,
      original.locationId,
    );
    const quantityDelta = -original.quantityDelta;
    const occurredAt = new Date();
    const referenceDocumentUri = `cohen-inventory://reversal/${idempotencyKey}`;

    try {
      reversal = await db.inventoryMovement.create({
        data: {
          shop,
          idempotencyKey,
          type: "REVERSAL",
          status: "PENDING",
          occurredAt,
          userId,
          staffMemberId,
          locationId: original.locationId,
          deviceId,
          barcode: original.barcode,
          sku: original.sku,
          productId: original.productId,
          productTitle: original.productTitle,
          variantId: original.variantId,
          variantTitle: original.variantTitle,
          inventoryItemId: original.inventoryItemId,
          quantityDelta,
          reason: "correction",
          supplier: original.supplier,
          supplierRecordId: original.supplierRecordId,
          note,
          beforeAvailable,
          afterAvailable: null,
          referenceDocumentUri,
          reversalOfId: original.id,
          requestPayload: {
            source:
              deviceId === "desktop-admin" ? "ADMIN_DESKTOP" : "SHOPIFY_POS",
            occurredAt: occurredAt.toISOString(),
            originalMovementId: original.id,
            quantityDelta,
            note,
            userId,
            staffMemberId,
            deviceId,
          },
        },
      });
    } catch (error) {
      reversal = await db.inventoryMovement.findFirst({
        where: {
          OR: [{ idempotencyKey }, { reversalOfId: original.id }],
        },
      });
      if (!reversal) throw error;
      if (reversal.idempotencyKey !== idempotencyKey) {
        throw new InventoryDomainError(
          "Otra corrección ya está registrada para esta entrada.",
          { status: 409, code: "MOVEMENT_ALREADY_REVERSED" },
        );
      }
    }
  }

  if (reversal.beforeAvailable === null) {
    throw new InventoryDomainError(
      "No existe una existencia inicial para completar la corrección.",
      { status: 409, code: "STARTING_QUANTITY_MISSING" },
    );
  }

  let adjustment;
  try {
    adjustment = await adjustAvailableQuantity(admin, {
      inventoryItemId: reversal.inventoryItemId,
      locationId: reversal.locationId,
      delta: reversal.quantityDelta,
      changeFromQuantity: reversal.beforeAvailable,
      reason: "correction",
      referenceDocumentUri: reversal.referenceDocumentUri,
      idempotencyKey: reversal.idempotencyKey,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Shopify rechazó el ajuste.";
    const transient = isTransientInventoryFailure(error);
    await db.inventoryMovement.updateMany({
      where: { id: reversal.id, status: { in: ["PENDING", "RECONCILING"] } },
      data: {
        status: transient ? "RECONCILING" : "FAILED",
        reconciliationStatus: transient ? "UNKNOWN" : "NEEDS_REVIEW",
        reconciliationError: message,
        errorMessage: message,
        responsePayload:
          error instanceof InventoryDomainError && error.details
            ? { details: error.details }
            : undefined,
      },
    });
    if (transient) {
      throw new InventoryDomainError(
        "Shopify no confirmó la corrección. Vuelve a pulsar Confirmar corrección; el mismo folio se recuperará sin duplicarla.",
        {
          status: 503,
          code: "INVENTORY_RECONCILING",
          details: { movementId: reversal.id, idempotencyKey: reversal.idempotencyKey },
        },
      );
    }
    throw error;
  }

  const availableChange = adjustment.group.changes.find(
    (change) => change.name === "available" && change.delta === reversal.quantityDelta,
  );

  const committed = await db.inventoryMovement.update({
    where: { id: reversal.id },
    data: {
      status: "COMMITTED",
      afterAvailable:
        availableChange?.quantityAfterChange ??
        reversal.beforeAvailable + reversal.quantityDelta,
      shopifyAdjustmentGroupId: adjustment.group.id || null,
      shopifyAdjustmentAt: new Date(adjustment.group.createdAt),
      shopifyAdjustmentReason: adjustment.group.reason,
      responsePayload: adjustment.raw,
      errorMessage: null,
      reconciliationStatus: "MATCHED",
      reconciledAt: new Date(),
      reconciliationError: null,
    },
  });

  return { movement: movementJson(committed), created: true };
}
