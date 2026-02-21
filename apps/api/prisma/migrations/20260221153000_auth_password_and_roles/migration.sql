-- CreateEnum
CREATE TYPE "FamilyRole" AS ENUM ('parent', 'child', 'caregiver');

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "passwordHash" TEXT,
ADD COLUMN "role" "FamilyRole" NOT NULL DEFAULT 'parent';

-- AlterTable
ALTER TABLE "FamilyInvite"
ADD COLUMN "role" "FamilyRole" NOT NULL DEFAULT 'parent';
