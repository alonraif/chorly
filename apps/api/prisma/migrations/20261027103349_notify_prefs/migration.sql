-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notifyPrefs" JSONB NOT NULL DEFAULT '{}';
