ALTER TABLE "CafeSale" ADD COLUMN "communityVoucherRedemptionId" TEXT;
ALTER TABLE "CafeSale" ADD COLUMN "communityVoucherRedeemedCents" INTEGER NOT NULL DEFAULT 0;
