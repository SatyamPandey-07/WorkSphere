# Automated 90-Day Decibel Telemetry Archival

The `/api/cron/archive-telemetry` endpoint maintains historical `TelemetryRecord` data using the existing monthly PostgreSQL range partitions.

## Schedule and authentication

The repository configures a monthly production Vercel Cron invocation for 03:00 UTC on the first day of each month. Set `CRON_SECRET` in the production environment. Vercel sends it as an `Authorization: Bearer <CRON_SECRET>` header; the route uses the shared timing-safe cron authorization helper and returns HTTP 401 for unauthorized requests.

## Retention and archival behavior

- The archive worker calculates a rolling 90-day cutoff.
- It only detaches a complete monthly `TelemetryRecord` partition when that partition's upper boundary is at or before the cutoff. The month that intersects the cutoff remains attached, so recent readings are not archived early.
- Before detaching a partition, the same database transaction writes per-venue noise summaries to `telemetry_archive.noise_monthly_summary`: reading count, average decibels, minimum decibels, and maximum decibels.
- The source partition is detached from `TelemetryRecord` and moved to the `telemetry_archive` schema. The aggregate write and detach are transactional; a failure rolls both back.
- The response reports the cutoff, archived partitions, retained partitions, and elapsed time.

The endpoint is safe to invoke repeatedly: it discovers attached partitions on each run, and the summary table uses `(venue_id, month_start)` as its key so a repeated summary write updates the existing monthly aggregate rather than creating duplicates.

## Manual invocation

```bash
curl -X GET "https://<your-production-domain>/api/cron/archive-telemetry" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Do not expose `CRON_SECRET` in client-side code or commit its value to the repository.
