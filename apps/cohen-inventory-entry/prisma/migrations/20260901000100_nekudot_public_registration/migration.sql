ALTER TABLE "NekudotMember" ADD COLUMN "community" TEXT;
ALTER TABLE "NekudotMember" ADD COLUMN "photoFileName" TEXT;
ALTER TABLE "NekudotMember" ADD COLUMN "enrollmentStatus" TEXT NOT NULL DEFAULT 'ACTIVE';

CREATE TABLE "NekudotPortalSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    CONSTRAINT "NekudotPortalSession_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "NekudotMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NekudotPortalSession_tokenHash_key" ON "NekudotPortalSession"("tokenHash");
CREATE INDEX "NekudotPortalSession_memberId_expiresAt_idx" ON "NekudotPortalSession"("memberId", "expiresAt");

CREATE TABLE "NekudotBrokerSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "brokerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    CONSTRAINT "NekudotBrokerSession_brokerId_fkey" FOREIGN KEY ("brokerId") REFERENCES "NekudotBroker" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NekudotBrokerSession_tokenHash_key" ON "NekudotBrokerSession"("tokenHash");
CREATE INDEX "NekudotBrokerSession_brokerId_expiresAt_idx" ON "NekudotBrokerSession"("brokerId", "expiresAt");

CREATE TABLE "NekudotMembershipPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "memberId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MERCADO_PAGO',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "externalReference" TEXT NOT NULL,
    "preferenceId" TEXT,
    "subscriptionId" TEXT,
    "paymentId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'MXN',
    "checkoutUrl" TEXT,
    "rawPayload" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "paidAt" DATETIME,
    CONSTRAINT "NekudotMembershipPayment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "NekudotMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NekudotMembershipPayment_externalReference_key" ON "NekudotMembershipPayment"("externalReference");
CREATE UNIQUE INDEX "NekudotMembershipPayment_preferenceId_key" ON "NekudotMembershipPayment"("preferenceId");
CREATE UNIQUE INDEX "NekudotMembershipPayment_subscriptionId_key" ON "NekudotMembershipPayment"("subscriptionId");
CREATE UNIQUE INDEX "NekudotMembershipPayment_paymentId_key" ON "NekudotMembershipPayment"("paymentId");
CREATE INDEX "NekudotMembershipPayment_memberId_status_createdAt_idx" ON "NekudotMembershipPayment"("memberId", "status", "createdAt");
