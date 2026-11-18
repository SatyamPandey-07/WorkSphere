-- Step 1: Create Partitioned Telemetry Table
CREATE TABLE IF NOT EXISTS "TelemetryReading" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "venueId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "readingType" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "recorded_at" TIMESTAMPTZ NOT NULL,
    PRIMARY KEY ("recorded_at", "id")
) PARTITION BY RANGE ("recorded_at");

-- Create indexes on partition key and device lookup
CREATE INDEX IF NOT EXISTS "idx_telemetry_recorded_at" ON "TelemetryReading" ("recorded_at");
CREATE INDEX IF NOT EXISTS "idx_telemetry_device_venue" ON "TelemetryReading" ("deviceId", "venueId");

-- Step 2: Function to Create Weekly Partition Tables Dynamically
CREATE OR REPLACE FUNCTION create_weekly_telemetry_partition(target_date TIMESTAMPTZ)
RETURNS TEXT AS $$
DECLARE
    start_of_week TIMESTAMPTZ;
    end_of_week TIMESTAMPTZ;
    partition_name TEXT;
BEGIN
    start_of_week := date_trunc('week', target_date);
    end_of_week := start_of_week + INTERVAL '1 week';
    partition_name := 'telemetry_reading_y' || to_char(start_of_week, 'YYYY') || '_w' || to_char(start_of_week, 'IW');

    IF NOT EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = partition_name
    ) THEN
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I PARTITION OF "TelemetryReading" FOR VALUES FROM (%L) TO (%L);',
            partition_name,
            start_of_week,
            end_of_week
        );
    END IF;

    RETURN partition_name;
END;
$$ LANGUAGE plpgsql;

-- Step 3: Seed Initial Partitions
SELECT create_weekly_telemetry_partition(NOW() - INTERVAL '2 weeks');
SELECT create_weekly_telemetry_partition(NOW() - INTERVAL '1 week');
SELECT create_weekly_telemetry_partition(NOW());
SELECT create_weekly_telemetry_partition(NOW() + INTERVAL '1 week');
SELECT create_weekly_telemetry_partition(NOW() + INTERVAL '2 weeks');
SELECT create_weekly_telemetry_partition(NOW() + INTERVAL '3 weeks');
SELECT create_weekly_telemetry_partition(NOW() + INTERVAL '4 weeks');