-- CreateTable
CREATE TABLE "PushNotificationLog_Partitioned" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "venueId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushNotificationLog_Partitioned_pkey" PRIMARY KEY ("id", "createdAt")
) PARTITION BY RANGE ("createdAt");

-- AddForeignKey
ALTER TABLE "PushNotificationLog_Partitioned" ADD CONSTRAINT "PushNotificationLog_Partitioned_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create monthly partitions for June, July, August, September, October 2026
CREATE TABLE IF NOT EXISTS "PushNotificationLog_y2026m06" PARTITION OF "PushNotificationLog_Partitioned"
    FOR VALUES FROM ('2026-06-01 00:00:00') TO ('2026-07-01 00:00:00');

CREATE TABLE IF NOT EXISTS "PushNotificationLog_y2026m07" PARTITION OF "PushNotificationLog_Partitioned"
    FOR VALUES FROM ('2026-07-01 00:00:00') TO ('2026-08-01 00:00:00');

CREATE TABLE IF NOT EXISTS "PushNotificationLog_y2026m08" PARTITION OF "PushNotificationLog_Partitioned"
    FOR VALUES FROM ('2026-08-01 00:00:00') TO ('2026-09-01 00:00:00');

CREATE TABLE IF NOT EXISTS "PushNotificationLog_y2026m09" PARTITION OF "PushNotificationLog_Partitioned"
    FOR VALUES FROM ('2026-09-01 00:00:00') TO ('2026-10-01 00:00:00');

CREATE TABLE IF NOT EXISTS "PushNotificationLog_y2026m10" PARTITION OF "PushNotificationLog_Partitioned"
    FOR VALUES FROM ('2026-10-01 00:00:00') TO ('2026-11-01 00:00:00');

-- Migrate any existing records if table exists
DO $$
BEGIN
    IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'PushNotificationLog') THEN
        INSERT INTO "PushNotificationLog_Partitioned" ("id", "userId", "venueId", "title", "body", "status", "error", "read", "createdAt")
        SELECT "id", "userId", "venueId", "title", "body", "status", "error", "read", "createdAt"
        FROM "PushNotificationLog";
        
        DROP TABLE "PushNotificationLog" CASCADE;
    END IF;
END $$;

-- Rename partitioned table to standard table name
ALTER TABLE "PushNotificationLog_Partitioned" RENAME TO "PushNotificationLog";

-- Rename indexes or constraints
CREATE INDEX "PushNotificationLog_createdAt_idx" ON "PushNotificationLog" ("createdAt");
CREATE INDEX "PushNotificationLog_status_idx" ON "PushNotificationLog" ("status");
