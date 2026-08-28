-- CreateTable
CREATE TABLE "RetailStaff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "pinSalt" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'CASHIER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RetailPosSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    CONSTRAINT "RetailPosSession_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "RetailStaff" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RetailRegisterShift" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openingCashCents" INTEGER NOT NULL DEFAULT 0,
    "closedAt" DATETIME,
    "closingCashCents" INTEGER,
    "expectedCashCents" INTEGER,
    "cashVarianceCents" INTEGER,
    "terminalCountedCents" INTEGER,
    "terminalExpectedCents" INTEGER,
    "terminalVarianceCents" INTEGER,
    "notes" TEXT,
    CONSTRAINT "RetailRegisterShift_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "RetailStaff" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RetailSale" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "staffId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "externalReference" TEXT,
    "grossCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "subtotalCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "cashPaidCents" INTEGER NOT NULL DEFAULT 0,
    "terminalPaidCents" INTEGER NOT NULL DEFAULT 0,
    "cashReceivedCents" INTEGER,
    "changeCents" INTEGER NOT NULL DEFAULT 0,
    "currencyCode" TEXT NOT NULL DEFAULT 'MXN',
    "items" JSONB NOT NULL,
    "customerId" TEXT,
    "customerName" TEXT,
    "customerEmail" TEXT,
    "shopifyOrderId" TEXT,
    "shopifyOrderName" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "syncedAt" DATETIME,
    "lastPrintedAt" DATETIME,
    "printCount" INTEGER NOT NULL DEFAULT 0,
    "refundedAt" DATETIME,
    "refundedByName" TEXT,
    "shopifyRefundId" TEXT,
    "refundIdempotencyKey" TEXT,
    "nekudotMemberId" TEXT,
    "nekudotRedemptionId" TEXT,
    "nekudotRedeemedCents" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "RetailSale_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "RetailStaff" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RetailSale_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "RetailRegisterShift" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "RetailStaff_shop_normalizedName_key" ON "RetailStaff"("shop", "normalizedName");
CREATE INDEX "RetailStaff_shop_active_name_idx" ON "RetailStaff"("shop", "active", "name");
CREATE UNIQUE INDEX "RetailPosSession_tokenHash_key" ON "RetailPosSession"("tokenHash");
CREATE INDEX "RetailPosSession_shop_expiresAt_idx" ON "RetailPosSession"("shop", "expiresAt");
CREATE INDEX "RetailPosSession_staffId_revokedAt_idx" ON "RetailPosSession"("staffId", "revokedAt");
CREATE INDEX "RetailRegisterShift_shop_status_openedAt_idx" ON "RetailRegisterShift"("shop", "status", "openedAt");
CREATE INDEX "RetailRegisterShift_staffId_openedAt_idx" ON "RetailRegisterShift"("staffId", "openedAt");
CREATE UNIQUE INDEX "RetailSale_shop_idempotencyKey_key" ON "RetailSale"("shop", "idempotencyKey");
CREATE INDEX "RetailSale_shop_createdAt_idx" ON "RetailSale"("shop", "createdAt");
CREATE INDEX "RetailSale_shop_status_createdAt_idx" ON "RetailSale"("shop", "status", "createdAt");
CREATE INDEX "RetailSale_shiftId_createdAt_idx" ON "RetailSale"("shiftId", "createdAt");
CREATE INDEX "RetailSale_shopifyOrderId_idx" ON "RetailSale"("shopifyOrderId");
CREATE INDEX "RetailSale_customerId_idx" ON "RetailSale"("customerId");
CREATE INDEX "RetailSale_nekudotMemberId_idx" ON "RetailSale"("nekudotMemberId");
CREATE INDEX "RetailSale_nekudotRedemptionId_idx" ON "RetailSale"("nekudotRedemptionId");
CREATE UNIQUE INDEX "RetailSale_refundIdempotencyKey_key" ON "RetailSale"("refundIdempotencyKey");
