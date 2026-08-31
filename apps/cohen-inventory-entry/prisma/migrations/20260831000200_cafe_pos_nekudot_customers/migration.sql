ALTER TABLE "CafeSale"
  ADD COLUMN "customerId" TEXT,
  ADD COLUMN "customerName" TEXT,
  ADD COLUMN "customerEmail" TEXT;

CREATE INDEX "CafeSale_customerId_idx" ON "CafeSale"("customerId");
