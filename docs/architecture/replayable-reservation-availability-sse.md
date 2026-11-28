# Replayable Reservation Availability SSE Architecture

Documents the `: heartbeat` comment frame format, default cadence, and `EventSource` client expectations for replayable reservation availability streams.

## 1. `: heartbeat` Frame Format & Default Interval

* **Format:** SSE comment frame starting with `:` and terminated by a blank line (`: heartbeat\n\n` or `: heartbeat <timestamp>\n\n`), ignored by `EventSource` event dispatch while keeping idle connections active.
* **Default Interval:** `15000 ms` (15 seconds) by default when idle, reset when a domain availability event is emitted.

## 2. `EventSource` Client Expectations

* Relies on native `EventSource` reconnects and `Last-Event-ID` replay to recover missed availability updates.
* Uses a client liveness/idle watchdog (e.g., 30-45s without stream activity) since comment frames do not trigger `message` or named event listeners.
* Deduplicates replayed events idempotently by event ID.
