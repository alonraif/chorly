-- CreateEnum
CREATE TYPE "MoneyLedgerType" AS ENUM ('earn');

-- AlterTable
ALTER TABLE "ChoreDefinition"
  ADD COLUMN "isTemplate" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ChoreInstance"
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvedByUserId" TEXT,
  ADD COLUMN "rewardAmount" DECIMAL(65,30),
  ADD COLUMN "notes" JSONB,
  ADD COLUMN "photoKeys" JSONB;

-- CreateTable
CREATE TABLE "MoneyLedger" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "MoneyLedgerType" NOT NULL,
  "amount" DECIMAL(65,30) NOT NULL,
  "instanceId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MoneyLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_tenantId_isActive_idx" ON "User"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "User_tenantId_isAway_idx" ON "User"("tenantId", "isAway");

-- CreateIndex
CREATE INDEX "ChoreDefinition_tenantId_isTemplate_idx" ON "ChoreDefinition"("tenantId", "isTemplate");

-- CreateIndex
CREATE INDEX "ChoreDefinition_tenantId_deletedAt_idx" ON "ChoreDefinition"("tenantId", "deletedAt");

-- CreateIndex
CREATE INDEX "ChoreInstance_tenantId_dueAt_idx" ON "ChoreInstance"("tenantId", "dueAt");

-- CreateIndex
CREATE INDEX "ChoreInstance_tenantId_status_dueAt_idx" ON "ChoreInstance"("tenantId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "InstanceAssignment_userId_instanceId_idx" ON "InstanceAssignment"("userId", "instanceId");

-- CreateIndex
CREATE INDEX "ChoreCompletion_userId_doneAt_idx" ON "ChoreCompletion"("userId", "doneAt");

-- CreateIndex
CREATE INDEX "ChoreCompletion_instanceId_undoneAt_idx" ON "ChoreCompletion"("instanceId", "undoneAt");

-- CreateIndex
CREATE INDEX "MoneyLedger_tenantId_userId_createdAt_idx" ON "MoneyLedger"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "MoneyLedger_instanceId_idx" ON "MoneyLedger"("instanceId");

-- AddForeignKey
ALTER TABLE "ChoreInstance" ADD CONSTRAINT "ChoreInstance_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyLedger" ADD CONSTRAINT "MoneyLedger_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyLedger" ADD CONSTRAINT "MoneyLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyLedger" ADD CONSTRAINT "MoneyLedger_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "ChoreInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
