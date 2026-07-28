-- CreateTable
CREATE TABLE "SalesSyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceShop" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SHOPIFY_ADMIN_API',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "costCapturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ordersSeen" INTEGER NOT NULL DEFAULT 0,
    "ordersImported" INTEGER NOT NULL DEFAULT 0,
    "lineItemsSeen" INTEGER NOT NULL DEFAULT 0,
    "refundsSeen" INTEGER NOT NULL DEFAULT 0,
    "oldestOrderAt" DATETIME,
    "newestOrderAt" DATETIME,
    "errorMessage" TEXT,
    "metadata" JSONB
);

-- CreateTable
CREATE TABLE "SalesOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceShop" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "processedAt" DATETIME,
    "shopifyUpdatedAt" DATETIME NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" DATETIME,
    "currencyCode" TEXT NOT NULL,
    "financialStatus" TEXT,
    "fulfillmentStatus" TEXT,
    "sourceName" TEXT,
    "test" BOOLEAN NOT NULL DEFAULT false,
    "includedInProfit" BOOLEAN NOT NULL DEFAULT false,
    "originalSalesCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "refundedProductCents" INTEGER NOT NULL DEFAULT 0,
    "refundedPaymentCents" INTEGER NOT NULL DEFAULT 0,
    "netSalesCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "currentTotalCents" INTEGER NOT NULL DEFAULT 0,
    "originalItemQuantity" INTEGER NOT NULL DEFAULT 0,
    "netItemQuantity" INTEGER NOT NULL DEFAULT 0,
    "calculableCostCents" INTEGER NOT NULL DEFAULT 0,
    "calculableProfitCents" INTEGER NOT NULL DEFAULT 0,
    "coveredNetSalesCents" INTEGER NOT NULL DEFAULT 0,
    "missingCostSalesCents" INTEGER NOT NULL DEFAULT 0,
    "profitComplete" BOOLEAN NOT NULL DEFAULT false,
    "rawPayload" JSONB,
    "lastSyncRunId" TEXT,
    CONSTRAINT "SalesOrder_lastSyncRunId_fkey" FOREIGN KEY ("lastSyncRunId") REFERENCES "SalesSyncRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SalesLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "shopifyLineItemId" TEXT NOT NULL,
    "shopifyProductId" TEXT,
    "shopifyVariantId" TEXT,
    "shopifyInventoryItemId" TEXT,
    "productHandle" TEXT,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "sku" TEXT,
    "originalQuantity" INTEGER NOT NULL,
    "netQuantity" INTEGER NOT NULL,
    "refundedQuantity" INTEGER NOT NULL DEFAULT 0,
    "originalUnitPriceCents" INTEGER NOT NULL,
    "originalSalesCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "refundedSalesCents" INTEGER NOT NULL DEFAULT 0,
    "netSalesCents" INTEGER NOT NULL,
    "currentUnitCostCents" INTEGER,
    "calculatedCostCents" INTEGER,
    "calculatedProfitCents" INTEGER,
    "marginBasisPoints" INTEGER,
    "costSource" TEXT,
    "costCapturedAt" DATETIME,
    "missingCostReason" TEXT,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPayload" JSONB,
    CONSTRAINT "SalesLineItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SalesRefund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "shopifyRefundId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "successfulAmountCents" INTEGER NOT NULL DEFAULT 0,
    "productSubtotalCents" INTEGER NOT NULL DEFAULT 0,
    "productQuantity" INTEGER NOT NULL DEFAULT 0,
    "transactionStatus" TEXT,
    "rawPayload" JSONB,
    CONSTRAINT "SalesRefund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "SalesOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductCostSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceShop" TEXT NOT NULL,
    "shopifyProductId" TEXT,
    "shopifyVariantId" TEXT NOT NULL,
    "shopifyInventoryItemId" TEXT,
    "productHandle" TEXT,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT,
    "sku" TEXT,
    "unitCostCents" INTEGER,
    "currencyCode" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'SHOPIFY_INVENTORY_ITEM_UNIT_COST',
    "capturedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncRunId" TEXT NOT NULL,
    CONSTRAINT "ProductCostSnapshot_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SalesSyncRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "SalesSyncRun_sourceShop_startedAt_idx" ON "SalesSyncRun"("sourceShop", "startedAt");

-- CreateIndex
CREATE INDEX "SalesSyncRun_status_idx" ON "SalesSyncRun"("status");

-- CreateIndex
CREATE INDEX "SalesOrder_sourceShop_createdAt_idx" ON "SalesOrder"("sourceShop", "createdAt");

-- CreateIndex
CREATE INDEX "SalesOrder_sourceShop_includedInProfit_createdAt_idx" ON "SalesOrder"("sourceShop", "includedInProfit", "createdAt");

-- CreateIndex
CREATE INDEX "SalesOrder_sourceShop_name_idx" ON "SalesOrder"("sourceShop", "name");

-- CreateIndex
CREATE INDEX "SalesOrder_lastSyncRunId_idx" ON "SalesOrder"("lastSyncRunId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_sourceShop_shopifyOrderId_key" ON "SalesOrder"("sourceShop", "shopifyOrderId");

-- CreateIndex
CREATE INDEX "SalesLineItem_shopifyVariantId_idx" ON "SalesLineItem"("shopifyVariantId");

-- CreateIndex
CREATE INDEX "SalesLineItem_sku_idx" ON "SalesLineItem"("sku");

-- CreateIndex
CREATE INDEX "SalesLineItem_productTitle_idx" ON "SalesLineItem"("productTitle");

-- CreateIndex
CREATE UNIQUE INDEX "SalesLineItem_orderId_shopifyLineItemId_key" ON "SalesLineItem"("orderId", "shopifyLineItemId");

-- CreateIndex
CREATE INDEX "SalesRefund_createdAt_idx" ON "SalesRefund"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SalesRefund_orderId_shopifyRefundId_key" ON "SalesRefund"("orderId", "shopifyRefundId");

-- CreateIndex
CREATE INDEX "ProductCostSnapshot_sourceShop_shopifyVariantId_capturedAt_idx" ON "ProductCostSnapshot"("sourceShop", "shopifyVariantId", "capturedAt");

-- CreateIndex
CREATE INDEX "ProductCostSnapshot_sourceShop_sku_capturedAt_idx" ON "ProductCostSnapshot"("sourceShop", "sku", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCostSnapshot_syncRunId_shopifyVariantId_key" ON "ProductCostSnapshot"("syncRunId", "shopifyVariantId");
