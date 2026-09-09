-- CreateTable
CREATE TABLE "CommunityVoucherFund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "programKey" TEXT NOT NULL DEFAULT 'cohens',
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "lifetimeLoadedCents" INTEGER NOT NULL DEFAULT 0,
    "lifetimeGrantedCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CommunityVoucherFundEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "programKey" TEXT NOT NULL DEFAULT 'cohens',
    "fundId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "balanceAfterCents" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommunityVoucherFundEntry_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "CommunityVoucherFund" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommunityVoucherRedemption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "programKey" TEXT NOT NULL DEFAULT 'cohens',
    "walletId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVED',
    "amountCents" INTEGER NOT NULL,
    "restoredCents" INTEGER NOT NULL DEFAULT 0,
    "cartReference" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "discountCode" TEXT,
    "shopifyDiscountId" TEXT,
    "shopifyOrderId" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "appliedAt" DATETIME,
    "cancelledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CommunityVoucherRedemption_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "CommunityVoucherWallet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CommunityVoucherFund_programKey_key" ON "CommunityVoucherFund"("programKey");
CREATE UNIQUE INDEX "CommunityVoucherFundEntry_programKey_idempotencyKey_key" ON "CommunityVoucherFundEntry"("programKey", "idempotencyKey");
CREATE INDEX "CommunityVoucherFundEntry_fundId_occurredAt_idx" ON "CommunityVoucherFundEntry"("fundId", "occurredAt");
CREATE UNIQUE INDEX "CommunityVoucherRedemption_discountCode_key" ON "CommunityVoucherRedemption"("discountCode");
CREATE UNIQUE INDEX "CommunityVoucherRedemption_programKey_idempotencyKey_key" ON "CommunityVoucherRedemption"("programKey", "idempotencyKey");
CREATE INDEX "CommunityVoucherRedemption_shop_status_expiresAt_idx" ON "CommunityVoucherRedemption"("shop", "status", "expiresAt");
CREATE INDEX "CommunityVoucherRedemption_walletId_status_createdAt_idx" ON "CommunityVoucherRedemption"("walletId", "status", "createdAt");
CREATE INDEX "CommunityVoucherRedemption_shopifyOrderId_idx" ON "CommunityVoucherRedemption"("shopifyOrderId");

ALTER TABLE "RetailSale" ADD COLUMN "communityVoucherRedemptionId" TEXT;
ALTER TABLE "RetailSale" ADD COLUMN "communityVoucherRedeemedCents" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "RetailSale_communityVoucherRedemptionId_idx" ON "RetailSale"("communityVoucherRedemptionId");
