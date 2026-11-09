-- Issue #3528: range-partition TelemetryRecord by timestamp (monthly).
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
       AND c.relname = 'TelemetryRecord';

    -- When an unpartitioned table already exists, preserve it temporarily.
    IF existing_kind IS NOT NULL AND existing_kind <> 'p' THEN
        ALTER TABLE "TelemetryRecord"
          RENAME TO "TelemetryRecord_unpartitioned_3528";
    END IF;

    -- Create the partitioned parent for a new database or a converted table.
    IF existing_kind IS NULL OR existing_kind <> 'p' THEN
        CREATE TABLE "TelemetryRecord" (
            "id" TEXT NOT NULL,
            "venueId" TEXT NOT NULL,
            "download" DOUBLE PRECISION,
            "upload" DOUBLE PRECISION,
            "latency" DOUBLE PRECISION,
            "noiseLevel" DOUBLE PRECISION,
            "occupancy" INTEGER,
            "presence" BOOLEAN DEFAULT true,
            "crowdLevel" TEXT,
            "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT "TelemetryRecord_pkey"
              PRIMARY KEY ("id", "timestamp"),
            CONSTRAINT "TelemetryRecord_venueId_fkey"
              FOREIGN KEY ("venueId") REFERENCES "Venue"("id")
              ON DELETE CASCADE ON UPDATE CASCADE
        ) PARTITION BY RANGE ("timestamp");

        CREATE INDEX "TelemetryRecord_venueId_idx"
          ON "TelemetryRecord" ("venueId");
        CREATE INDEX "TelemetryRecord_timestamp_idx"
          ON "TelemetryRecord" ("timestamp");
        CREATE INDEX "TelemetryRecord_venueId_timestamp_idx"
          ON "TelemetryRecord" ("venueId", "timestamp");

        -- Create partitions covering 12 historical months and 12 future
        -- months relative to migration time. Runtime maintenance creates more.
        FOR month_start IN
            SELECT generate_series(
                date_trunc('month', CURRENT_DATE) - INTERVAL '12 months',
                date_trunc('month', CURRENT_DATE) + INTERVAL '12 months',
                INTERVAL '1 month'
            )::date
        LOOP
            month_end := (month_start + INTERVAL '1 month')::date;
            partition_name := format(
                'TelemetryRecord_y%sm%s',
                to_char(month_start, 'YYYY'),
                to_char(month_start, 'MM')
            );

            EXECUTE format(
                'CREATE TABLE IF NOT EXISTS %I PARTITION OF "TelemetryRecord" FOR VALUES FROM (%L) TO (%L)',
                partition_name,
                month_start,
                month_end
            );
        END LOOP;

        -- Default partition for boundary cases
        CREATE TABLE IF NOT EXISTS "TelemetryRecord_default"
          PARTITION OF "TelemetryRecord" DEFAULT;

        IF to_regclass('public."TelemetryRecord_unpartitioned_3528"') IS NOT NULL THEN
            INSERT INTO "TelemetryRecord" (
                "id",
                "venueId",
                "download",
                "upload",
                "latency",
                "noiseLevel",
                "occupancy",
                "presence",
                "crowdLevel",
                "timestamp"
            )
            SELECT
                "id",
                "venueId",
                "download",
                "upload",
                "latency",
                "noiseLevel",
                "occupancy",
                "presence",
                "crowdLevel",
                "timestamp"
            FROM "TelemetryRecord_unpartitioned_3528";

            DROP TABLE "TelemetryRecord_unpartitioned_3528";
        END IF;
    END IF;
END
$$;
