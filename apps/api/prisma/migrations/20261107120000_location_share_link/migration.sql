-- CreateTable
CREATE TABLE "LocationShareLink" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "userIds" TEXT[],
    "createdById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "pinHash" TEXT,
    "pinSetAt" TIMESTAMP(3),
    "failedPins" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationShareView" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationShareView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LocationShareLink_tokenHash_key" ON "LocationShareLink"("tokenHash");

-- CreateIndex
CREATE INDEX "LocationShareLink_tenantId_expiresAt_idx" ON "LocationShareLink"("tenantId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LocationShareView_tokenHash_key" ON "LocationShareView"("tokenHash");

-- CreateIndex
CREATE INDEX "LocationShareView_linkId_idx" ON "LocationShareView"("linkId");

-- AddForeignKey
ALTER TABLE "LocationShareLink" ADD CONSTRAINT "LocationShareLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationShareLink" ADD CONSTRAINT "LocationShareLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationShareView" ADD CONSTRAINT "LocationShareView_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "LocationShareLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
