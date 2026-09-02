import assert from "node:assert/strict";
import test from "node:test";
import {
  availableFromAuditPayload,
  classifyMovementEvidence,
  isTransientInventoryFailure,
  matchAuditEventToMovement,
  sameShopifyId,
  toShopifyGid,
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

test("normaliza IDs numéricos históricos al formato global de Shopify", () => {
  assert.equal(
    toShopifyGid("InventoryItem", "50895117353208"),
    "gid://shopify/InventoryItem/50895117353208",
  );
  assert.equal(
    toShopifyGid("InventoryItem", "gid://shopify/InventoryItem/50895117353208"),
    "gid://shopify/InventoryItem/50895117353208",
  );
  assert.equal(
    sameShopifyId("50895117353208", "gid://shopify/InventoryItem/50895117353208"),
    true,
  );
});

test("concilia evidencia GID con movimientos y webhooks numéricos históricos", () => {
  const numericMovement = {
    id: "move-numeric",
    inventoryItemId: "50895117353208",
    locationId: "123456",
    quantityDelta: 1,
    referenceDocumentUri: "gid://cohens/InventoryMovement/move-numeric",
    shopifyAdjustmentGroupId: "998877",
  };
  assert.deepEqual(classifyMovementEvidence(numericMovement, {
    id: "gid://shopify/InventoryAdjustmentGroup/998877",
    referenceDocumentUri: numericMovement.referenceDocumentUri,
    changes: [{
      name: "available",
      delta: 1,
      quantityAfterChange: 4,
      item: { id: "gid://shopify/InventoryItem/50895117353208" },
      location: { id: "gid://shopify/Location/123456" },
    }],
  }), { status: "MATCHED", quantityAfterChange: 4 });

  const matched = matchAuditEventToMovement({
    inventoryItemId: "50895117353208",
    locationId: "123456",
    occurredAt: new Date("2026-09-02T20:00:00.000Z"),
    capturedAt: new Date("2026-09-02T20:00:01.000Z"),
    payload: { available: 4 },
  }, [{
    id: numericMovement.id,
    inventoryItemId: "gid://shopify/InventoryItem/50895117353208",
    locationId: "gid://shopify/Location/123456",
    occurredAt: new Date("2026-09-02T20:00:00.000Z"),
    afterAvailable: 4,
  }]);
  assert.equal(matched?.id, numericMovement.id);
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
