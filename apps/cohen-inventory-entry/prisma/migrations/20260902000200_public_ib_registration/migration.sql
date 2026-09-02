ALTER TABLE "NekudotBroker" ADD COLUMN "community" TEXT;
ALTER TABLE "NekudotBroker" ADD COLUMN "referralWord" TEXT;

CREATE UNIQUE INDEX "NekudotBroker_programKey_referralWord_key"
ON "NekudotBroker"("programKey", "referralWord");
