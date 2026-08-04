-- CreateTable
CREATE TABLE "CafeStaff" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "pinSalt" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CafePosSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    CONSTRAINT "CafePosSession_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "CafeStaff" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CafeRegisterShift" (
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
    CONSTRAINT "CafeRegisterShift_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "CafeStaff" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CafeSale" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "staffId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "externalReference" TEXT,
    "subtotalCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'MXN',
    "items" JSONB NOT NULL,
    "shopifyOrderId" TEXT,
    "shopifyOrderName" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "syncedAt" DATETIME,
    "lastPrintedAt" DATETIME,
    "printCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "CafeSale_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "CafeStaff" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CafeSale_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CafeRegisterShift" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CafeStaff_shop_normalizedName_key" ON "CafeStaff"("shop", "normalizedName");
CREATE INDEX "CafeStaff_shop_active_name_idx" ON "CafeStaff"("shop", "active", "name");
CREATE UNIQUE INDEX "CafePosSession_tokenHash_key" ON "CafePosSession"("tokenHash");
CREATE INDEX "CafePosSession_shop_expiresAt_idx" ON "CafePosSession"("shop", "expiresAt");
CREATE INDEX "CafePosSession_staffId_revokedAt_idx" ON "CafePosSession"("staffId", "revokedAt");
CREATE INDEX "CafeRegisterShift_shop_status_openedAt_idx" ON "CafeRegisterShift"("shop", "status", "openedAt");
CREATE INDEX "CafeRegisterShift_staffId_openedAt_idx" ON "CafeRegisterShift"("staffId", "openedAt");
CREATE UNIQUE INDEX "CafeSale_shop_idempotencyKey_key" ON "CafeSale"("shop", "idempotencyKey");
CREATE INDEX "CafeSale_shop_createdAt_idx" ON "CafeSale"("shop", "createdAt");
CREATE INDEX "CafeSale_shop_status_createdAt_idx" ON "CafeSale"("shop", "status", "createdAt");
CREATE INDEX "CafeSale_shiftId_paymentMethod_idx" ON "CafeSale"("shiftId", "paymentMethod");
CREATE INDEX "CafeSale_shopifyOrderId_idx" ON "CafeSale"("shopifyOrderId");
