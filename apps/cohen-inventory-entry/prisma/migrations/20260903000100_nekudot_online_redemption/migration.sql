ALTER TABLE "NekudotRedemption" ADD COLUMN "discountCode" TEXT;
ALTER TABLE "NekudotRedemption" ADD COLUMN "shopifyDiscountId" TEXT;

CREATE UNIQUE INDEX "NekudotRedemption_discountCode_key"
ON "NekudotRedemption"("discountCode");

CREATE UNIQUE INDEX "NekudotRedemption_shopifyDiscountId_key"
ON "NekudotRedemption"("shopifyDiscountId");
