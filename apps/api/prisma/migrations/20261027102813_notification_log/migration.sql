-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('due_soon', 'overdue', 'parent_overdue');

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "day" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NotificationLog_instanceId_idx" ON "NotificationLog"("instanceId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationLog_userId_instanceId_kind_day_key" ON "NotificationLog"("userId", "instanceId", "kind", "day");

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "ChoreInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
