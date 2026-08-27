ALTER TABLE "CafeSale" ADD COLUMN "nekudotMemberId" TEXT;
ALTER TABLE "CafeSale" ADD COLUMN "nekudotRedemptionId" TEXT;
ALTER TABLE "CafeSale" ADD COLUMN "nekudotRedeemedCents" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "CafeSale_nekudotMemberId_idx" ON "CafeSale"("nekudotMemberId");
CREATE INDEX "CafeSale_nekudotRedemptionId_idx" ON "CafeSale"("nekudotRedemptionId");

CREATE TABLE "NekudotBroker" (
  "id" TEXT NOT NULL PRIMARY KEY, "programKey" TEXT NOT NULL DEFAULT 'cohens',
  "code" TEXT NOT NULL, "displayName" TEXT NOT NULL, "email" TEXT, "phone" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true, "commissionBalanceCents" INTEGER NOT NULL DEFAULT 0,
  "lifetimeCommissionCents" INTEGER NOT NULL DEFAULT 0, "paidOutCents" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "NekudotMember" (
  "id" TEXT NOT NULL PRIMARY KEY, "programKey" TEXT NOT NULL DEFAULT 'cohens',
  "displayName" TEXT NOT NULL, "email" TEXT, "phone" TEXT, "active" BOOLEAN NOT NULL DEFAULT true,
  "currencyCode" TEXT NOT NULL DEFAULT 'MXN', "balanceCents" INTEGER NOT NULL DEFAULT 0,
  "reservedCents" INTEGER NOT NULL DEFAULT 0, "lifetimeEarnedCents" INTEGER NOT NULL DEFAULT 0,
  "lifetimeRedeemedCents" INTEGER NOT NULL DEFAULT 0, "brokerId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "NekudotMember_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "NekudotBroker"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "NekudotCustomerIdentity" (
  "id" TEXT NOT NULL PRIMARY KEY, "programKey" TEXT NOT NULL DEFAULT 'cohens', "memberId" TEXT NOT NULL,
  "shop" TEXT NOT NULL, "shopifyCustomerId" TEXT NOT NULL, "shopifyLegacyCustomerId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL, "email" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "NekudotCustomerIdentity_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "NekudotMember"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "NekudotCredential" (
  "id" TEXT NOT NULL PRIMARY KEY, "programKey" TEXT NOT NULL DEFAULT 'cohens', "memberId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL, "lastFour" TEXT NOT NULL, "kind" TEXT NOT NULL DEFAULT 'RFID_OR_QR',
  "label" TEXT, "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "NekudotCredential_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "NekudotMember"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "NekudotLedgerEntry" (
  "id" TEXT NOT NULL PRIMARY KEY, "programKey" TEXT NOT NULL DEFAULT 'cohens', "memberId" TEXT, "brokerId" TEXT,
  "walletType" TEXT NOT NULL, "type" TEXT NOT NULL, "amountCents" INTEGER NOT NULL,
  "balanceAfterCents" INTEGER NOT NULL, "currencyCode" TEXT NOT NULL DEFAULT 'MXN', "shop" TEXT,
  "source" TEXT NOT NULL, "sourceId" TEXT, "idempotencyKey" TEXT NOT NULL, "description" TEXT NOT NULL,
  "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "NekudotLedgerEntry_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "NekudotMember"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NekudotLedgerEntry_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "NekudotBroker"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "NekudotOrderAccrual" (
  "id" TEXT NOT NULL PRIMARY KEY, "programKey" TEXT NOT NULL DEFAULT 'cohens', "shop" TEXT NOT NULL,
  "shopifyOrderId" TEXT NOT NULL, "orderName" TEXT NOT NULL, "memberId" TEXT NOT NULL, "brokerId" TEXT,
  "purchaseCents" INTEGER NOT NULL, "clientEarnedCents" INTEGER NOT NULL, "brokerEarnedCents" INTEGER NOT NULL,
  "currencyCode" TEXT NOT NULL DEFAULT 'MXN', "calculationHash" TEXT NOT NULL,
  "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "NekudotOrderAccrual_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "NekudotMember"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "NekudotOrderAccrual_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "NekudotBroker"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "NekudotRedemption" (
  "id" TEXT NOT NULL PRIMARY KEY, "programKey" TEXT NOT NULL DEFAULT 'cohens', "memberId" TEXT NOT NULL,
  "shop" TEXT NOT NULL, "amountCents" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'RESERVED',
  "idempotencyKey" TEXT NOT NULL, "cartReference" TEXT, "shopifyOrderId" TEXT, "expiresAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  "appliedAt" DATETIME, "cancelledAt" DATETIME,
  CONSTRAINT "NekudotRedemption_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "NekudotMember"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NekudotBroker_programKey_code_key" ON "NekudotBroker"("programKey", "code");
CREATE INDEX "NekudotBroker_programKey_active_displayName_idx" ON "NekudotBroker"("programKey", "active", "displayName");
CREATE INDEX "NekudotMember_programKey_active_updatedAt_idx" ON "NekudotMember"("programKey", "active", "updatedAt");
CREATE INDEX "NekudotMember_brokerId_active_idx" ON "NekudotMember"("brokerId", "active");
CREATE INDEX "NekudotMember_programKey_displayName_idx" ON "NekudotMember"("programKey", "displayName");
CREATE UNIQUE INDEX "NekudotCustomerIdentity_shop_shopifyCustomerId_key" ON "NekudotCustomerIdentity"("shop", "shopifyCustomerId");
CREATE UNIQUE INDEX "NekudotCustomerIdentity_memberId_shop_key" ON "NekudotCustomerIdentity"("memberId", "shop");
CREATE INDEX "NekudotCustomerIdentity_programKey_shop_displayName_idx" ON "NekudotCustomerIdentity"("programKey", "shop", "displayName");
CREATE UNIQUE INDEX "NekudotCredential_programKey_tokenHash_key" ON "NekudotCredential"("programKey", "tokenHash");
CREATE INDEX "NekudotCredential_memberId_active_idx" ON "NekudotCredential"("memberId", "active");
CREATE UNIQUE INDEX "NekudotLedgerEntry_programKey_idempotencyKey_key" ON "NekudotLedgerEntry"("programKey", "idempotencyKey");
CREATE INDEX "NekudotLedgerEntry_memberId_occurredAt_idx" ON "NekudotLedgerEntry"("memberId", "occurredAt");
CREATE INDEX "NekudotLedgerEntry_brokerId_occurredAt_idx" ON "NekudotLedgerEntry"("brokerId", "occurredAt");
CREATE INDEX "NekudotLedgerEntry_programKey_shop_occurredAt_idx" ON "NekudotLedgerEntry"("programKey", "shop", "occurredAt");
CREATE INDEX "NekudotLedgerEntry_programKey_source_sourceId_idx" ON "NekudotLedgerEntry"("programKey", "source", "sourceId");
CREATE UNIQUE INDEX "NekudotOrderAccrual_shop_shopifyOrderId_key" ON "NekudotOrderAccrual"("shop", "shopifyOrderId");
CREATE INDEX "NekudotOrderAccrual_memberId_processedAt_idx" ON "NekudotOrderAccrual"("memberId", "processedAt");
CREATE INDEX "NekudotOrderAccrual_brokerId_processedAt_idx" ON "NekudotOrderAccrual"("brokerId", "processedAt");
CREATE INDEX "NekudotOrderAccrual_programKey_processedAt_idx" ON "NekudotOrderAccrual"("programKey", "processedAt");
CREATE UNIQUE INDEX "NekudotRedemption_programKey_idempotencyKey_key" ON "NekudotRedemption"("programKey", "idempotencyKey");
CREATE INDEX "NekudotRedemption_memberId_status_expiresAt_idx" ON "NekudotRedemption"("memberId", "status", "expiresAt");
CREATE INDEX "NekudotRedemption_shop_shopifyOrderId_idx" ON "NekudotRedemption"("shop", "shopifyOrderId");
