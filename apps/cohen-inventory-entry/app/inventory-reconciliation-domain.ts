export const AUDIT_MATCH_WINDOW_MS = 10 * 60 * 1000;

export type MovementEvidenceInput = {
  id: string;
  inventoryItemId: string;
  locationId: string;
  quantityDelta: number;
  referenceDocumentUri: string;
  shopifyAdjustmentGroupId: string | null;
};

export type AdjustmentGroupEvidence = {
  id: string;
  referenceDocumentUri: string | null;
  changes: Array<{
    name: string;
    delta: number;
    quantityAfterChange: number | null;
    item: { id: string } | null;
    location: { id: string; name?: string | null } | null;
  }>;
};

export type MovementEvidenceResult =
  | { status: "MATCHED"; quantityAfterChange: number | null }
  | { status: "MISSING_SHOPIFY"; reason: string }
  | { status: "EVIDENCE_MISMATCH"; reason: string };

export function classifyMovementEvidence(
  movement: MovementEvidenceInput,
  group: AdjustmentGroupEvidence | null,
): MovementEvidenceResult {
  if (!movement.shopifyAdjustmentGroupId) {
    return {
      status: "MISSING_SHOPIFY",
      reason: "El movimiento local no conserva el ID del ajuste de Shopify.",
    };
  }
  if (!group) {
    return {
      status: "MISSING_SHOPIFY",
      reason: "Shopify no devolvió el grupo de ajuste registrado localmente.",
    };
  }
  if (group.referenceDocumentUri !== movement.referenceDocumentUri) {
    return {
      status: "EVIDENCE_MISMATCH",
      reason: "La referencia documental de Shopify no coincide con el movimiento local.",
    };
  }

  const change = group.changes.find(
    (item) =>
      item.name === "available" &&
      item.item?.id === movement.inventoryItemId &&
      item.location?.id === movement.locationId &&
      item.delta === movement.quantityDelta,
  );
  if (!change) {
    return {
      status: "EVIDENCE_MISMATCH",
      reason: "Artículo, ubicación o cantidad no coinciden con la evidencia de Shopify.",
    };
  }
  return { status: "MATCHED", quantityAfterChange: change.quantityAfterChange };
}

export type AuditableMovement = {
  id: string;
  inventoryItemId: string;
  locationId: string;
  occurredAt: Date;
  afterAvailable: number | null;
};

export type AuditableEvent = {
  inventoryItemId: string | null;
  locationId: string | null;
  occurredAt: Date | null;
  capturedAt: Date;
  payload: unknown;
};

export function availableFromAuditPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const value = record.available ?? record.available_quantity ?? record.quantity;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export function matchAuditEventToMovement(
  event: AuditableEvent,
  movements: AuditableMovement[],
  windowMs = AUDIT_MATCH_WINDOW_MS,
) {
  if (!event.inventoryItemId || !event.locationId) return null;
  const eventAt = (event.occurredAt ?? event.capturedAt).valueOf();
  const available = availableFromAuditPayload(event.payload);

  return (
    movements.find((movement) => {
      if (
        movement.inventoryItemId !== event.inventoryItemId ||
        movement.locationId !== event.locationId
      ) {
        return false;
      }
      if (Math.abs(movement.occurredAt.valueOf() - eventAt) > windowMs) return false;
      return available === null || movement.afterAvailable === available;
    }) ?? null
  );
}

export function isTransientInventoryFailure(error: unknown) {
  if (!(error instanceof Error)) return true;
  const candidate = error as Error & { status?: number; code?: string };
  if (candidate.code === "SHOPIFY_ADJUSTMENT_REJECTED") return false;
  if (candidate.status && candidate.status < 500) return false;
  return true;
}

export function reconciliationFingerprint(parts: Array<string | null | undefined>) {
  return parts.map((part) => part || "unknown").join(":");
}
