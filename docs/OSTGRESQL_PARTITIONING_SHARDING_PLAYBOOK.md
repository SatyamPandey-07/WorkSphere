# PostgreSQL Partitioning & Pruning Playbook

## 1. Overview
WorkSphere ingests millions of telemetry readings (decibels, temperature, seat check-ins) daily. To maintain index performance and sub-10ms range scans, historical telemetry data is partitioned weekly by `recorded_at`.

---

## 2. Partition Pruning Optimization

To verify that queries prune unused partition tables during aggregation range scans:

```sql
EXPLAIN (ANALYZE, COSTS OFF, BUFFERS)
SELECT "deviceId", AVG("value") AS avg_decibel
FROM "TelemetryReading"
WHERE "recorded_at" >= '2026-11-01 00:00:00+00'
  AND "recorded_at" < '2026-11-08 00:00:00+00'
GROUP BY "deviceId";
