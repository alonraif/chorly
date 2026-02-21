-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('en', 'he');

-- CreateEnum
CREATE TYPE "InstanceStatus" AS ENUM ('assigned', 'done', 'approved');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL DEFAULT 'ILS',
    "defaultLocale" "Locale" NOT NULL DEFAULT 'he',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT NOT NULL,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "locale" "Locale" NOT NULL DEFAULT 'he',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isAway" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChoreDefinition" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "title_he" TEXT NOT NULL,
    "hasReward" BOOLEAN NOT NULL DEFAULT false,
    "rewardAmount" DECIMAL(65,30),
    "allowNotes" BOOLEAN NOT NULL DEFAULT true,
    "allowPhotoProof" BOOLEAN NOT NULL DEFAULT false,
    "scheduleJson" JSONB NOT NULL,
    "assignmentJson" JSONB NOT NULL,
    "lastAssignedUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChoreDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChoreInstance" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "choreId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "InstanceStatus" NOT NULL DEFAULT 'assigned',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChoreInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstanceAssignment" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstanceAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChoreCompletion" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "doneAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),

    CONSTRAINT "ChoreCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ChoreInstance_tenantId_choreId_dueAt_key" ON "ChoreInstance"("tenantId", "choreId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "InstanceAssignment_instanceId_userId_key" ON "InstanceAssignment"("instanceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChoreCompletion_instanceId_userId_key" ON "ChoreCompletion"("instanceId", "userId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChoreDefinition" ADD CONSTRAINT "ChoreDefinition_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChoreInstance" ADD CONSTRAINT "ChoreInstance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChoreInstance" ADD CONSTRAINT "ChoreInstance_choreId_fkey" FOREIGN KEY ("choreId") REFERENCES "ChoreDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstanceAssignment" ADD CONSTRAINT "InstanceAssignment_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "ChoreInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstanceAssignment" ADD CONSTRAINT "InstanceAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChoreCompletion" ADD CONSTRAINT "ChoreCompletion_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "ChoreInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChoreCompletion" ADD CONSTRAINT "ChoreCompletion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
