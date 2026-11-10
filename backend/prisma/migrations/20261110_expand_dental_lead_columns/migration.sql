-- AlterTable
ALTER TABLE "leads" ADD COLUMN "practiceType" TEXT,
ADD COLUMN "chairCount" INTEGER,
ADD COLUMN "doctorCount" INTEGER,
ADD COLUMN "googleRating" DECIMAL(3,2),
ADD COLUMN "googleReviewCount" INTEGER;

-- CreateIndex
CREATE INDEX "leads_practiceType_idx" ON "leads"("practiceType");
