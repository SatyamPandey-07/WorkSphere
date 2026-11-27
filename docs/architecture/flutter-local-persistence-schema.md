# WorkSphere Flutter Local Persistence Schema (Drift / SQLite)

Defines the local persistence schema in Flutter (Drift/SQLite) for the offline booking draft queue, DTN bundle sync, conflict resolution, and retry queue parity.

## 1. Tables (`booking_drafts`, `dtn_bundles`, `sync_retry_queue`)

* **`booking_drafts`:** Stores offline booking drafts with `draft_id` (PK), `venue_id`, `booking_date_ymd` (`YYYY-MM-DD`), `slot_start_utc`, `slot_end_utc`, `base_server_version`, `sync_status`, `conflict_reason`, and `server_snapshot_json`.
* **`dtn_bundles`:** Stores store-and-forward DTN bundles with `bundle_id` (PK), `topic`, `key_epoch`, `payload_json`, `priority`, `expires_at_ms`, `delivery_state`, and `hop_count`.
* **`sync_retry_queue`:** Tracks `idempotency_key` (UNIQUE), `attempt_count`, `max_attempts`, `next_retry_at_ms`, `lease_expires_at_ms`, and `last_error_code`.

## 2. Conflict Resolution

* Mark `SLOT_TAKEN` or `ACL_REVOKED` responses as `sync_status = 'conflict'` with `server_snapshot_json` instead of overwriting confirmed bookings or spinning retries.
* Mark DTN bundles past `expires_at_ms` as `expired`.

## 3. Retry Queue Parity

* Use exponential backoff capped at `maxDelayMs`, enforce `idempotency_key` deduplication, recover stale `lease_expires_at_ms` locks on restart, and move exhausted retries to `dead_letter`.
