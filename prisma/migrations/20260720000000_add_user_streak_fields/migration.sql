-- AlterTable: add streak tracking fields to User
ALTER TABLE "User"
  ADD COLUMN "currentStreak"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "longestStreak"   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastCheckInDate" TEXT;
