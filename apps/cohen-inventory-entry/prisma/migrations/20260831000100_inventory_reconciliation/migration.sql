ALTER TABLE "InventoryMovement" ADD COLUMN "reconciliationStatus" TEXT NOT NULL DEFAULT 'PENDING';
ALTER TABLE "InventoryMovement" ADD COLUMN "reconciledAt" DATETIME;
ALTER TABLE "InventoryMovement" ADD COLUMN "reconciliationError" TEXT;

CREATE TABLE "InventoryReconciliationRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "triggerKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "movementsExamined" INTEGER NOT NULL DEFAULT 0,
    "movementsMatched" INTEGER NOT NULL DEFAULT 0,
    "externalChanges" INTEGER NOT NULL DEFAULT 0,
    "uncertainMovements" INTEGER NOT NULL DEFAULT 0,
    "pendingSales" INTEGER NOT NULL DEFAULT 0,
    "openIssues" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "metadata" JSONB
);

CREATE TABLE "InventoryReconciliationIssue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fingerprint" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "severity" TEXT NOT NULL DEFAULT 'WARNING',
    "source" TEXT NOT NULL,
    "occurredAt" DATETIME,
    "locationId" TEXT,
    "locationName" TEXT,
    "inventoryItemId" TEXT,
    "productId" TEXT,
    "variantId" TEXT,
    "productTitle" TEXT,
    "variantTitle" TEXT,
    "sku" TEXT,
    "barcode" TEXT,
    "quantityDelta" INTEGER,
    "expectedAvailable" INTEGER,
    "actualAvailable" INTEGER,
    "movementId" TEXT,
    "auditEventId" TEXT,
    "localRecordType" TEXT,
    "localRecordId" TEXT,
    "summary" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "metadata" JSONB,
    "reviewedAt" DATETIME,
    "reviewedBy" TEXT,
    "reviewNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "InventoryReconciliationIssue_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "InventoryMovement" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InventoryReconciliationIssue_auditEventId_fkey" FOREIGN KEY ("auditEventId") REFERENCES "InventoryAuditEvent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "InventoryReconciliationRun_shop_triggerKey_key" ON "InventoryReconciliationRun"("shop", "triggerKey");
CREATE INDEX "InventoryReconciliationRun_shop_startedAt_idx" ON "InventoryReconciliationRun"("shop", "startedAt");
CREATE INDEX "InventoryReconciliationRun_status_startedAt_idx" ON "InventoryReconciliationRun"("status", "startedAt");
CREATE UNIQUE INDEX "InventoryReconciliationIssue_fingerprint_key" ON "InventoryReconciliationIssue"("fingerprint");
CREATE INDEX "InventoryReconciliationIssue_shop_status_occurredAt_idx" ON "InventoryReconciliationIssue"("shop", "status", "occurredAt");
CREATE INDEX "InventoryReconciliationIssue_shop_kind_status_idx" ON "InventoryReconciliationIssue"("shop", "kind", "status");
CREATE INDEX "InventoryReconciliationIssue_inventoryItemId_locationId_idx" ON "InventoryReconciliationIssue"("inventoryItemId", "locationId");
CREATE INDEX "InventoryReconciliationIssue_movementId_idx" ON "InventoryReconciliationIssue"("movementId");
CREATE INDEX "InventoryReconciliationIssue_auditEventId_idx" ON "InventoryReconciliationIssue"("auditEventId");
