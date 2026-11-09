-- Issue #3362: monthly range partitioning for the high-volume WifiTelemetry
-- (venue telemetry) and AdminAuditLog tables.
--
-- PostgreSQL requires a partitioned table's primary key to include the
-- partition key, so the primary keys become (id, timestamp) and
-- (id, createdAt). schema.prisma models these composite keys; the native
-- partitioning DDL lives here. Runtime maintenance (src/lib/partitionRetention.ts,
-- /api/cron/partition-maintenance) creates future partitions and enforces
-- retention.
--
-- Safe on new and existing databases: an existing unpartitioned table is
-- renamed aside, its rows copied into the partitioned parent (rows outside
-- the pre-created months land in the DEFAULT partition), then dropped.
-- Re-running is a no-op once the table is partitioned.

CREATE OR REPLACE FUNCTION pg_temp.partition_monthly_3362(
    tbl TEXT,
    key_col TEXT,
    create_sql TEXT,
    index_sql TEXT[],
    column_list TEXT
) RETURNS VOID LANGUAGE plpgsql AS $fn$
DECLARE
    existing_kind "char";
    old_tbl TEXT := tbl || '_unpartitioned_3362';
    month_start DATE;
    idx RECORD;
    stmt TEXT;
BEGIN
    SELECT c.relkind INTO existing_kind
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = tbl;

    IF existing_kind = 'p' THEN
        RETURN; -- already partitioned
    END IF;

    IF existing_kind IS NOT NULL THEN
        EXECUTE format('ALTER TABLE %I RENAME TO %I', tbl, old_tbl);
        -- Index-backed names are unique per schema: free them for the new parent.
        EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I',
                       old_tbl, tbl || '_pkey', old_tbl || '_pkey');
        FOR idx IN
            SELECT i.relname AS name
              FROM pg_index x
              JOIN pg_class i ON i.oid = x.indexrelid
              JOIN pg_class t ON t.oid = x.indrelid
             WHERE t.relname = old_tbl AND NOT x.indisprimary
        LOOP
            EXECUTE format('DROP INDEX %I', idx.name);
        END LOOP;
    END IF;

    EXECUTE create_sql;
    FOREACH stmt IN ARRAY index_sql LOOP
        EXECUTE stmt;
    END LOOP;

    -- Six past months through two future months; maintenance keeps it rolling.
    FOR month_start IN
        SELECT generate_series(
            date_trunc('month', CURRENT_DATE) - INTERVAL '6 months',
            date_trunc('month', CURRENT_DATE) + INTERVAL '2 months',
            INTERVAL '1 month'
        )::date
    LOOP
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
            format('%s_y%sm%s', tbl, to_char(month_start, 'YYYY'), to_char(month_start, 'MM')),
            tbl,
            month_start,
            (month_start + INTERVAL '1 month')::date
        );
    END LOOP;

    -- Catches legacy/out-of-range rows so the copy below can never fail.
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %I DEFAULT', tbl || '_default', tbl);

    IF existing_kind IS NOT NULL THEN
        EXECUTE format('INSERT INTO %I (%s) SELECT %s FROM %I', tbl, column_list, column_list, old_tbl);
        EXECUTE format('DROP TABLE %I', old_tbl);
    END IF;
END
$fn$;

SELECT pg_temp.partition_monthly_3362(
    'WifiTelemetry',
    'timestamp',
    $sql$
    CREATE TABLE "WifiTelemetry" (
        "id" TEXT NOT NULL,
        "venueId" TEXT NOT NULL,
        "download" DOUBLE PRECISION NOT NULL,
        "upload" DOUBLE PRECISION NOT NULL,
        "latency" DOUBLE PRECISION NOT NULL,
        "crowdLevel" TEXT NOT NULL,
        "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "WifiTelemetry_pkey" PRIMARY KEY ("id", "timestamp"),
        CONSTRAINT "WifiTelemetry_venueId_fkey" FOREIGN KEY ("venueId")
            REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE
    ) PARTITION BY RANGE ("timestamp")
    $sql$,
    ARRAY[
        'CREATE INDEX "WifiTelemetry_venueId_idx" ON "WifiTelemetry"("venueId")',
        'CREATE INDEX "WifiTelemetry_timestamp_idx" ON "WifiTelemetry"("timestamp")',
        'CREATE INDEX "WifiTelemetry_venueId_timestamp_idx" ON "WifiTelemetry"("venueId", "timestamp")'
    ],
    '"id", "venueId", "download", "upload", "latency", "crowdLevel", "timestamp"'
);

SELECT pg_temp.partition_monthly_3362(
    'AdminAuditLog',
    'createdAt',
    $sql$
    CREATE TABLE "AdminAuditLog" (
        "id" TEXT NOT NULL,
        "adminId" TEXT NOT NULL,
        "action" TEXT NOT NULL,
        "entityType" TEXT NOT NULL,
        "entityId" TEXT NOT NULL,
        "details" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id", "createdAt"),
        CONSTRAINT "AdminAuditLog_adminId_fkey" FOREIGN KEY ("adminId")
            REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
    ) PARTITION BY RANGE ("createdAt")
    $sql$,
    ARRAY[
        'CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt")'
    ],
    '"id", "adminId", "action", "entityType", "entityId", "details", "createdAt"'
);
