ALTER TABLE "NekudotOrderAccrual" ADD COLUMN "originalPurchaseCents" INTEGER NOT NULL DEFAULT 0;
UPDATE "NekudotOrderAccrual" SET "originalPurchaseCents" = "purchaseCents";

ALTER TABLE "NekudotRedemption" ADD COLUMN "restoredCents" INTEGER NOT NULL DEFAULT 0;
