-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_InventoryMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT,
    "staffMemberId" TEXT,
    "locationId" TEXT NOT NULL,
    "deviceId" TEXT,
    "barcode" TEXT NOT NULL,
    "sku" TEXT,
    "productId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "variantTitle" TEXT,
    "inventoryItemId" TEXT NOT NULL,
    "quantityDelta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "supplier" TEXT,
    "supplierRecordId" TEXT,
    "note" TEXT,
    "beforeAvailable" INTEGER,
    "afterAvailable" INTEGER,
    "referenceDocumentUri" TEXT NOT NULL,
    "shopifyAdjustmentGroupId" TEXT,
    "shopifyAdjustmentAt" DATETIME,
    "shopifyAdjustmentReason" TEXT,
    "requestPayload" JSONB,
    "responsePayload" JSONB,
    "errorMessage" TEXT,
    "reversalOfId" TEXT,
    CONSTRAINT "InventoryMovement_supplierRecordId_fkey" FOREIGN KEY ("supplierRecordId") REFERENCES "Supplier" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InventoryMovement_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "InventoryMovement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_InventoryMovement" ("afterAvailable", "barcode", "beforeAvailable", "createdAt", "deviceId", "errorMessage", "id", "idempotencyKey", "inventoryItemId", "locationId", "note", "occurredAt", "productId", "productTitle", "quantityDelta", "reason", "referenceDocumentUri", "requestPayload", "responsePayload", "reversalOfId", "shop", "shopifyAdjustmentAt", "shopifyAdjustmentGroupId", "shopifyAdjustmentReason", "sku", "staffMemberId", "status", "supplier", "type", "updatedAt", "userId", "variantId", "variantTitle") SELECT "afterAvailable", "barcode", "beforeAvailable", "createdAt", "deviceId", "errorMessage", "id", "idempotencyKey", "inventoryItemId", "locationId", "note", "occurredAt", "productId", "productTitle", "quantityDelta", "reason", "referenceDocumentUri", "requestPayload", "responsePayload", "reversalOfId", "shop", "shopifyAdjustmentAt", "shopifyAdjustmentGroupId", "shopifyAdjustmentReason", "sku", "staffMemberId", "status", "supplier", "type", "updatedAt", "userId", "variantId", "variantTitle" FROM "InventoryMovement";
DROP TABLE "InventoryMovement";
ALTER TABLE "new_InventoryMovement" RENAME TO "InventoryMovement";
CREATE UNIQUE INDEX "InventoryMovement_idempotencyKey_key" ON "InventoryMovement"("idempotencyKey");
CREATE UNIQUE INDEX "InventoryMovement_reversalOfId_key" ON "InventoryMovement"("reversalOfId");
CREATE INDEX "InventoryMovement_shop_occurredAt_idx" ON "InventoryMovement"("shop", "occurredAt");
CREATE INDEX "InventoryMovement_shop_barcode_idx" ON "InventoryMovement"("shop", "barcode");
CREATE INDEX "InventoryMovement_shop_locationId_idx" ON "InventoryMovement"("shop", "locationId");
CREATE INDEX "InventoryMovement_supplierRecordId_idx" ON "InventoryMovement"("supplierRecordId");
CREATE INDEX "InventoryMovement_status_idx" ON "InventoryMovement"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Supplier_shop_active_name_idx" ON "Supplier"("shop", "active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_shop_normalizedName_key" ON "Supplier"("shop", "normalizedName");
