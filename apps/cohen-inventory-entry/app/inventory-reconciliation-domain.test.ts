import assert from "node:assert/strict";
import test from "node:test";
import {
  availableFromAuditPayload,
  classifyMovementEvidence,
  isTransientInventoryFailure,
  matchAuditEventToMovement,
} from "./inventory-reconciliation-domain.ts";

const movement = {
  id: "movement-1",
  inventoryItemId: "gid://shopify/InventoryItem/1",
  locationId: "gid://shopify/Location/2",
  quantityDelta: 3,
  referenceDocumentUri: "cohen-inventory://receipt/key",
  shopifyAdjustmentGroupId: "gid://shopify/InventoryAdjustmentGroup/3",
};

test("clasifica evidencia exacta como conciliada", () => {
  assert.deepEqual(
    classifyMovementEvidence(movement, {
      id: movement.shopifyAdjustmentGroupId,
      referenceDocumentUri: movement.referenceDocumentUri,
      changes: [{
        name: "available",
        delta: 3,
        quantityAfterChange: 8,
        item: { id: movement.inventoryItemId },
        location: { id: movement.locationId },
      }],
    }),
    { status: "MATCHED", quantityAfterChange: 8 },
  );
});

test("detecta grupo ausente o evidencia distinta", () => {
  assert.equal(classifyMovementEvidence(movement, null).status, "MISSING_SHOPIFY");
  assert.equal(
    classifyMovementEvidence(movement, {
      id: movement.shopifyAdjustmentGroupId,
      referenceDocumentUri: movement.referenceDocumentUri,
      changes: [],
    }).status,
    "EVIDENCE_MISMATCH",
  );
});

test("empareja webhook por artículo, ubicación, tiempo y saldo", () => {
  const occurredAt = new Date("2026-08-28T16:00:00.000Z");
  const matched = matchAuditEventToMovement(
    {
      inventoryItemId: movement.inventoryItemId,
      locationId: movement.locationId,
      occurredAt: new Date(occurredAt.valueOf() + 30_000),
      capturedAt: occurredAt,
      payload: { available: 8 },
    },
    [{
      id: movement.id,
      inventoryItemId: movement.inventoryItemId,
      locationId: movement.locationId,
      occurredAt,
      afterAvailable: 8,
    }],
  );
  assert.equal(matched?.id, movement.id);
  assert.equal(availableFromAuditPayload({ available: 8 }), 8);
});

test("timeout es incierto y rechazo de negocio es definitivo", () => {
  assert.equal(isTransientInventoryFailure(new TypeError("fetch failed")), true);
  assert.equal(
    isTransientInventoryFailure(Object.assign(new Error("stale"), {
      status: 409,
      code: "SHOPIFY_ADJUSTMENT_REJECTED",
    })),
    false,
  );
});
