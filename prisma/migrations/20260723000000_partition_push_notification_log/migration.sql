-- Issue #1571: range-partition PushNotificationLog by createdAt (monthly).
--
-- Prisma models the composite primary key in schema.prisma, while the native
-- PostgreSQL partitioning DDL remains in this migration.

DO $$
DECLARE
    existing_kind "char";
    month_start DATE;
    month_end DATE;
    partition_name TEXT;
BEGIN
    SELECT c.relkind
      INTO existing_kind
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = 'PushNotificationLog';

    -- When an unpartitioned table already exists, preserve it temporarily.
    IF existing_kind IS NOT NULL AND existing_kind <> 'p' THEN
        ALTER TABLE "PushNotificationLog"
          RENAME TO "PushNotificationLog_unpartitioned_1571";
    END IF;

    -- Create the partitioned parent for a new database or a converted table.
    IF existing_kind IS NULL OR existing_kind <> 'p' THEN
        CREATE TABLE "PushNotificationLog" (
            "id" TEXT NOT NULL,
            "userId" TEXT NOT NULL,
            "venueId" TEXT,
            "title" TEXT NOT NULL,
            "body" TEXT NOT NULL,
            "status" TEXT NOT NULL,
            "error" TEXT,
            "read" BOOLEAN NOT NULL DEFAULT false,
            "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "PushNotificationLog_pkey"
              PRIMARY KEY ("id", "createdAt"),
            CONSTRAINT "PushNotificationLog_userId_fkey"
              FOREIGN KEY ("userId") REFERENCES "User"("id")
              ON DELETE CASCADE ON UPDATE CASCADE
        ) PARTITION BY RANGE ("createdAt");

        CREATE INDEX "PushNotificationLog_createdAt_idx"
          ON "PushNotificationLog" ("createdAt");
        CREATE INDEX "PushNotificationLog_status_idx"
          ON "PushNotificationLog" ("status");

        -- Create partitions covering six historical months and twelve future
        -- months relative to migration time. Runtime maintenance creates more.
        FOR month_start IN
            SELECT generate_series(
                date_trunc('month', CURRENT_DATE) - INTERVAL '6 months',
                date_trunc('month', CURRENT_DATE) + INTERVAL '12 months',
                INTERVAL '1 month'
            )::date
        LOOP
            month_end := (month_start + INTERVAL '1 month')::date;
            partition_name := format(
                'PushNotificationLog_y%sm%s',
                to_char(month_start, 'YYYY'),
                to_char(month_start, 'MM')
            );

            EXECUTE format(
                'CREATE TABLE IF NOT EXISTS %I PARTITION OF "PushNotificationLog" FOR VALUES FROM (%L) TO (%L)',
                partition_name,
                month_start,
                month_end
            );
        END LOOP;

        -- The default partition guarantees that legacy or unexpected dates do
        -- not make the data-copy step fail. It can later be drained safely.
        CREATE TABLE IF NOT EXISTS "PushNotificationLog_default"
          PARTITION OF "PushNotificationLog" DEFAULT;

        IF to_regclass('public."PushNotificationLog_unpartitioned_1571"') IS NOT NULL THEN
            INSERT INTO "PushNotificationLog" (
                "id",
                "userId",
                "venueId",
                "title",
                "body",
                "status",
                "error",
                "read",
                "createdAt"
            )
            SELECT
                "id",
                "userId",
                "venueId",
                "title",
                "body",
                "status",
                "error",
                "read",
                "createdAt"
            FROM "PushNotificationLog_unpartitioned_1571";

            DROP TABLE "PushNotificationLog_unpartitioned_1571";
        END IF;
    END IF;
END
$$;
