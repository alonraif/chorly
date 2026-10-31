-- AlterEnum
ALTER TYPE "PlaceKind" ADD VALUE 'store';

-- CreateEnum
CREATE TYPE "ShoppingState" AS ENUM ('needed', 'bought', 'removed');

-- CreateEnum
CREATE TYPE "ShoppingCategory" AS ENUM ('produce', 'dairy', 'meat', 'bakery', 'pantry', 'frozen', 'drinks', 'snacks', 'household', 'personal', 'baby', 'pets', 'other');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "shoppingSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ShoppingItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "quantity" TEXT,
    "note" TEXT,
    "category" "ShoppingCategory" NOT NULL DEFAULT 'other',
    "state" "ShoppingState" NOT NULL DEFAULT 'needed',
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "addedById" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "boughtById" TEXT,
    "boughtAt" TIMESTAMP(3),
    "timesBought" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ShoppingItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShoppingItem_tenantId_state_idx" ON "ShoppingItem"("tenantId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "ShoppingItem_tenantId_nameKey_key" ON "ShoppingItem"("tenantId", "nameKey");

-- AddForeignKey
ALTER TABLE "ShoppingItem" ADD CONSTRAINT "ShoppingItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingItem" ADD CONSTRAINT "ShoppingItem_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingItem" ADD CONSTRAINT "ShoppingItem_boughtById_fkey" FOREIGN KEY ("boughtById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
