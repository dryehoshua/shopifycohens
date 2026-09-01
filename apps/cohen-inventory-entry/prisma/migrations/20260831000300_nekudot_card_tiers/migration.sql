ALTER TABLE "NekudotMember" ADD COLUMN "cardTier" TEXT NOT NULL DEFAULT 'SILVER';

-- Los miembros anteriores operaban con la única tasa histórica de 5%.
UPDATE "NekudotMember" SET "cardTier" = 'BLUE';

ALTER TABLE "NekudotOrderAccrual" ADD COLUMN "cashbackTier" TEXT NOT NULL DEFAULT 'BLUE';
ALTER TABLE "NekudotOrderAccrual" ADD COLUMN "cashbackBasisPoints" INTEGER NOT NULL DEFAULT 500;
