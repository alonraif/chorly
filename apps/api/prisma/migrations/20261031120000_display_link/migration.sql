-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN "displayTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_displayTokenHash_key" ON "Tenant"("displayTokenHash");
