-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('pending', 'accepted', 'revoked', 'expired');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "isSystemAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FamilyInvite" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "inviterUserId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "status" "InviteStatus" NOT NULL DEFAULT 'pending',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FamilyInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FamilyInvite_token_key" ON "FamilyInvite"("token");
CREATE INDEX "FamilyInvite_tenantId_status_idx" ON "FamilyInvite"("tenantId", "status");
CREATE INDEX "FamilyInvite_email_status_idx" ON "FamilyInvite"("email", "status");
CREATE INDEX "User_isSystemAdmin_idx" ON "User"("isSystemAdmin");

-- AddForeignKey
ALTER TABLE "FamilyInvite" ADD CONSTRAINT "FamilyInvite_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FamilyInvite" ADD CONSTRAINT "FamilyInvite_inviterUserId_fkey" FOREIGN KEY ("inviterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
