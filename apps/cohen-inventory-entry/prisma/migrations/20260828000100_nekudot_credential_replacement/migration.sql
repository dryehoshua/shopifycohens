ALTER TABLE "NekudotCredential" ADD COLUMN "revokedAt" DATETIME;
ALTER TABLE "NekudotCredential" ADD COLUMN "revokedReason" TEXT;
ALTER TABLE "NekudotCredential" ADD COLUMN "revokedByShop" TEXT;
