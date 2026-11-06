-- CreateTable
CREATE TABLE "SkippedOccurrence" (
    "id" TEXT NOT NULL,
    "choreId" TEXT NOT NULL,
    "occurrenceAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkippedOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SkippedOccurrence_choreId_occurrenceAt_key" ON "SkippedOccurrence"("choreId", "occurrenceAt");

-- AddForeignKey
ALTER TABLE "SkippedOccurrence" ADD CONSTRAINT "SkippedOccurrence_choreId_fkey" FOREIGN KEY ("choreId") REFERENCES "ChoreDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
