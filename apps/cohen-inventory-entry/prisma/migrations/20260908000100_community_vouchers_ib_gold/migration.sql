-- CreateTable
CREATE TABLE "CommunityVoucherWallet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "programKey" TEXT NOT NULL DEFAULT 'cohens',
    "memberId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "reservedCents" INTEGER NOT NULL DEFAULT 0,
    "lifetimeGrantedCents" INTEGER NOT NULL DEFAULT 0,
    "lifetimeRedeemedCents" INTEGER NOT NULL DEFAULT 0,
    "activatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CommunityVoucherWallet_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "NekudotMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CommunityVoucherLedgerEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "programKey" TEXT NOT NULL DEFAULT 'cohens',
    "walletId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "balanceAfterCents" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommunityVoucherLedgerEntry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "CommunityVoucherWallet" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NekudotBrokerWithdrawal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "programKey" TEXT NOT NULL DEFAULT 'cohens',
    "brokerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    "processedBy" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NekudotBrokerWithdrawal_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "NekudotBroker" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- AlterTable
ALTER TABLE "NekudotBroker" ADD COLUMN "reservedWithdrawalCents" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE UNIQUE INDEX "CommunityVoucherWallet_memberId_key" ON "CommunityVoucherWallet"("memberId");
CREATE INDEX "CommunityVoucherWallet_programKey_status_updatedAt_idx" ON "CommunityVoucherWallet"("programKey", "status", "updatedAt");
CREATE UNIQUE INDEX "CommunityVoucherLedgerEntry_programKey_idempotencyKey_key" ON "CommunityVoucherLedgerEntry"("programKey", "idempotencyKey");
CREATE INDEX "CommunityVoucherLedgerEntry_walletId_occurredAt_idx" ON "CommunityVoucherLedgerEntry"("walletId", "occurredAt");
CREATE INDEX "CommunityVoucherLedgerEntry_programKey_source_sourceId_idx" ON "CommunityVoucherLedgerEntry"("programKey", "source", "sourceId");
CREATE INDEX "NekudotBrokerWithdrawal_brokerId_status_requestedAt_idx" ON "NekudotBrokerWithdrawal"("brokerId", "status", "requestedAt");
CREATE INDEX "NekudotBrokerWithdrawal_programKey_status_requestedAt_idx" ON "NekudotBrokerWithdrawal"("programKey", "status", "requestedAt");
