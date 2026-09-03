ALTER TABLE "NekudotBroker" ADD COLUMN "ownerMemberId" TEXT;

CREATE UNIQUE INDEX "NekudotBroker_ownerMemberId_key"
ON "NekudotBroker"("ownerMemberId");

CREATE TABLE "NekudotPendingClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "programKey" TEXT NOT NULL DEFAULT 'cohens',
    "shop" TEXT NOT NULL,
    "shopifyOrderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'MXN',
    "purchaseCents" INTEGER NOT NULL,
    "eligibleFinancialStatus" BOOLEAN NOT NULL DEFAULT false,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "orderUpdatedAt" DATETIME NOT NULL,
    "emailHash" TEXT,
    "phoneHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "claimedMemberId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "claimedAt" DATETIME,
    CONSTRAINT "NekudotPendingClaim_claimedMemberId_fkey" FOREIGN KEY ("claimedMemberId") REFERENCES "NekudotMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NekudotPendingClaim_shop_shopifyOrderId_key" ON "NekudotPendingClaim"("shop", "shopifyOrderId");
CREATE INDEX "NekudotPendingClaim_programKey_status_expiresAt_idx" ON "NekudotPendingClaim"("programKey", "status", "expiresAt");
CREATE INDEX "NekudotPendingClaim_phoneHash_status_idx" ON "NekudotPendingClaim"("phoneHash", "status");
CREATE INDEX "NekudotPendingClaim_emailHash_status_idx" ON "NekudotPendingClaim"("emailHash", "status");
CREATE INDEX "NekudotPendingClaim_claimedMemberId_claimedAt_idx" ON "NekudotPendingClaim"("claimedMemberId", "claimedAt");

CREATE TABLE "NekudotRegistrationRecovery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "programKey" TEXT NOT NULL DEFAULT 'cohens',
    "shop" TEXT NOT NULL,
    "shopifyCustomerId" TEXT NOT NULL,
    "requestedKind" TEXT NOT NULL,
    "requestedData" JSONB NOT NULL,
    "destinationPhone" TEXT,
    "maskedPhone" TEXT,
    "maskedEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "verifiedAt" DATETIME
);

CREATE INDEX "NekudotRegistrationRecovery_programKey_status_expiresAt_idx" ON "NekudotRegistrationRecovery"("programKey", "status", "expiresAt");
CREATE INDEX "NekudotRegistrationRecovery_shop_shopifyCustomerId_status_idx" ON "NekudotRegistrationRecovery"("shop", "shopifyCustomerId", "status");
