-- CreateTable
CREATE TABLE "InventoryMovement" (
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
    CONSTRAINT "InventoryMovement_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "InventoryMovement" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InventoryAuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "webhookId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "occurredAt" DATETIME,
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resourceId" TEXT,
    "locationId" TEXT,
    "inventoryItemId" TEXT,
    "productId" TEXT,
    "payload" JSONB NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_idempotencyKey_key" ON "InventoryMovement"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_reversalOfId_key" ON "InventoryMovement"("reversalOfId");

-- CreateIndex
CREATE INDEX "InventoryMovement_shop_occurredAt_idx" ON "InventoryMovement"("shop", "occurredAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_shop_barcode_idx" ON "InventoryMovement"("shop", "barcode");

-- CreateIndex
CREATE INDEX "InventoryMovement_shop_locationId_idx" ON "InventoryMovement"("shop", "locationId");

-- CreateIndex
CREATE INDEX "InventoryMovement_status_idx" ON "InventoryMovement"("status");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryAuditEvent_webhookId_key" ON "InventoryAuditEvent"("webhookId");

-- CreateIndex
CREATE INDEX "InventoryAuditEvent_shop_capturedAt_idx" ON "InventoryAuditEvent"("shop", "capturedAt");

-- CreateIndex
CREATE INDEX "InventoryAuditEvent_shop_topic_idx" ON "InventoryAuditEvent"("shop", "topic");

-- CreateIndex
CREATE INDEX "InventoryAuditEvent_inventoryItemId_idx" ON "InventoryAuditEvent"("inventoryItemId");

-- CreateIndex
CREATE INDEX "InventoryAuditEvent_productId_idx" ON "InventoryAuditEvent"("productId");
