ALTER TABLE "CafeSale" ADD COLUMN "refundedAt" DATETIME;
ALTER TABLE "CafeSale" ADD COLUMN "refundedByName" TEXT;
ALTER TABLE "CafeSale" ADD COLUMN "shopifyRefundId" TEXT;
ALTER TABLE "CafeSale" ADD COLUMN "refundIdempotencyKey" TEXT;

CREATE UNIQUE INDEX "CafeSale_refundIdempotencyKey_key" ON "CafeSale"("refundIdempotencyKey");
