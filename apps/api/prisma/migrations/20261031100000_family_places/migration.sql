-- CreateEnum
CREATE TYPE "PlaceKind" AS ENUM ('home', 'school', 'work', 'fun', 'other');

-- CreateEnum
CREATE TYPE "SharingMode" AS ENUM ('exact', 'blurred', 'paused');

-- CreateEnum
CREATE TYPE "TripMode" AS ENUM ('walk', 'drive');

-- CreateEnum
CREATE TYPE "PlaceRule" AS ENUM ('at_place', 'visited');

-- CreateEnum
CREATE TYPE "ErrandStatus" AS ENUM ('open', 'done');

-- AlterTable
ALTER TABLE "UserLocation" ADD COLUMN     "battery" INTEGER,
ADD COLUMN     "charging" BOOLEAN,
ADD COLUMN     "placeId" TEXT,
ADD COLUMN     "placeSince" TIMESTAMP(3),
ADD COLUMN     "speed" DOUBLE PRECISION,
ADD COLUMN     "tripEtaAt" TIMESTAMP(3),
ADD COLUMN     "tripMode" "TripMode",
ADD COLUMN     "tripPlaceId" TEXT;

-- AlterTable
ALTER TABLE "ChoreDefinition" ADD COLUMN     "placeRule" "PlaceRule",
ADD COLUMN     "requiredPlaceId" TEXT;

-- CreateTable
CREATE TABLE "LocationSettings" (
    "userId" TEXT NOT NULL,
    "mode" "SharingMode" NOT NULL DEFAULT 'exact',
    "shareUntil" TIMESTAMP(3),
    "recap" BOOLEAN NOT NULL DEFAULT false,
    "lowBatteryAlertedAt" TIMESTAMP(3),
    "quietAlertedAt" TIMESTAMP(3),

    CONSTRAINT "LocationSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "Place" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PlaceKind" NOT NULL DEFAULT 'other',
    "note" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "radiusM" INTEGER NOT NULL DEFAULT 150,
    "rewardAmount" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Place_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaceVisit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "arrivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),
    "rewarded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PlaceVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Errand" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "status" "ErrandStatus" NOT NULL DEFAULT 'open',
    "createdById" TEXT NOT NULL,
    "claimedById" TEXT,
    "remindedIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "Errand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapTag" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapTag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Place_tenantId_idx" ON "Place"("tenantId");

-- CreateIndex
CREATE INDEX "PlaceVisit_userId_arrivedAt_idx" ON "PlaceVisit"("userId", "arrivedAt");

-- CreateIndex
CREATE INDEX "PlaceVisit_placeId_idx" ON "PlaceVisit"("placeId");

-- CreateIndex
CREATE INDEX "Errand_tenantId_status_idx" ON "Errand"("tenantId", "status");

-- CreateIndex
CREATE INDEX "MapTag_tenantId_idx" ON "MapTag"("tenantId");

-- CreateIndex
CREATE INDEX "UserLocation_placeId_idx" ON "UserLocation"("placeId");

-- AddForeignKey
ALTER TABLE "UserLocation" ADD CONSTRAINT "UserLocation_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLocation" ADD CONSTRAINT "UserLocation_tripPlaceId_fkey" FOREIGN KEY ("tripPlaceId") REFERENCES "Place"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationSettings" ADD CONSTRAINT "LocationSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Place" ADD CONSTRAINT "Place_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaceVisit" ADD CONSTRAINT "PlaceVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaceVisit" ADD CONSTRAINT "PlaceVisit_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Errand" ADD CONSTRAINT "Errand_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Errand" ADD CONSTRAINT "Errand_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Errand" ADD CONSTRAINT "Errand_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapTag" ADD CONSTRAINT "MapTag_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapTag" ADD CONSTRAINT "MapTag_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChoreDefinition" ADD CONSTRAINT "ChoreDefinition_requiredPlaceId_fkey" FOREIGN KEY ("requiredPlaceId") REFERENCES "Place"("id") ON DELETE SET NULL ON UPDATE CASCADE;

