# Replayable Reservation Availability SSE

This document describes the reservation availability Server-Sent Events
(SSE) endpoint implemented by `src/app/api/reservations/events/route.ts` and
its replay log in `src/lib/reservations/replayableStream.ts`.

## Endpoint and response

```text
GET /api/reservations/events?venueId={venueId}
```

`venueId` is required. If it is absent or blank after trimming, the endpoint
returns HTTP `400` JSON:

```json
{ "error": "Missing required query parameter: venueId" }
```

For a valid venue, the endpoint returns HTTP `200` with:

```text
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

Each frame uses standard SSE lines: optional `id`, an `event` name, JSON
`data`, and a blank line.

## Cursor format and replay window

The `Last-Event-ID` cursor is a base-10, non-negative safe integer represented
as a decimal string, for example `42`. It is the replay log's monotonically
increasing numeric `cursor`, not the event's separate `eventId`.

- `Last-Event-ID` request header is preferred.
- If that header is absent, the endpoint accepts the `lastEventId` query
  parameter. A supplied header that is blank does not fall back to the query
  parameter.
- A missing or blank cursor skips replay and starts a live subscription.
- A non-empty cursor must contain only decimal digits and parse to a safe
  integer greater than or equal to zero.

The replay log retains at most **1,000 events by default**. When the bound is
exceeded, the oldest event is evicted. The `SharedReservationReplayLog`
constructor can be given another retention count, but the default exported
log uses 1,000.

For a valid cursor, replay returns retained events for this venue whose cursor
is greater than the requested cursor. The requested cursor is too old when it
is less than `oldestRetainedCursor - 1`; the cursor immediately preceding the
oldest retained event is still replayable. A cursor greater than the latest
cursor is ahead of the stream. Malformed, expired, and ahead-of-stream cursors
produce a `resync_required` SSE event with one of these reasons:

- `malformed_cursor`
- `cursor_expired`
- `cursor_ahead_of_stream`

The resync event includes `latestCursor` but has no SSE `id`. The endpoint does
not itself fetch or send a replacement snapshot, nor does it reset the
client's cursor. Clients should handle `resync_required` as an instruction to
recover their view outside this stream and reconnect appropriately.

## Event names and payloads

Every connection receives a `connected` event and then a `heartbeat` event
every 15 seconds while the stream remains open. Heartbeat and connected frames
do not have SSE IDs.

| SSE event | Data shape | ID |
| --- | --- | --- |
| `connected` | `{ "type": "connected", "venueId": string, "timestamp": ISO-8601 string }` | None |
| `heartbeat` | `{ "type": "heartbeat", "venueId": string, "timestamp": ISO-8601 string }` | None |
| `resync_required` | `{ "reason": string, "latestCursor": number, "venueId": string }` | None |
| `availability` | The published event object, with `venueId`, numeric `timestamp`, and—on live delivery—`cursor` and `eventId` | Numeric cursor when available |
| `desk_expired` | Expiration event data, normally including `type`, `deskId`, `seatId`, `timestamp`, and on live delivery `venueId`, `cursor`, and `eventId` | Numeric cursor when available |

All event types other than the three recognized expiration types are sent as
`availability`. The event bus creates live event IDs in the form
`evt_<timestamp>_<random-suffix>` and adds the log cursor to live data. The SSE
frame's `id` is the numeric cursor. Replayed frames use their retained cursor
as the SSE ID; their data is the retained event payload and does not receive
the event bus's live-only `cursor` or generated `eventId` additions.

Recognized expiration types are `DESK_HOLD_EXPIRED`,
`SEAT_HOLD_EXPIRED`, and `desk_reservation_expired`; they are emitted as
`desk_expired`. The legacy `desk_reservation_expired` type is normalized to
`DESK_HOLD_EXPIRED` in the delivered data.

Example live event:

```text
id: 42
event: availability
data: {"type":"DESK_HOLD_ACQUIRED","deskId":"desk-17","seatId":"seat-17","expiresAt":1795809600000,"venueId":"venue-seattle-01","timestamp":1795809300000,"cursor":42,"eventId":"evt_1795809300000_k4m8pz"}

```

Example replay-reset event:

```text
event: resync_required
data: {"reason":"cursor_expired","latestCursor":1048,"venueId":"venue-seattle-01"}

```

The replay log assigns cursors in publish order. Replayed events are delivered
in that order, filtered to the requested venue. A valid-cursor connection
receives replay frames, then `connected`, then later live frames. A
no-cursor connection subscribes before receiving `connected`. Live delivery is
not buffered across the replay-to-subscribe boundary, so an event published
between replay and subscription can be missed.

## Multi-instance behavior

`SharedReservationReplayLog` and the event bus in these files keep the replay
array, cursor counter, deduplication set, and subscriber maps in process
memory. Subscribers in the same process receive live events for their venue;
the default replay log deduplicates events by `eventId` while those IDs remain
in its retained set.

Despite the replay log's class name and comments describing multi-instance
fanout, these implementation files do not connect to Redis, a database
changefeed, or another cross-process pub/sub service. Separate application
processes therefore have separate replay logs and subscriber maps; cross-
instance delivery and a globally shared cursor are not guaranteed by this
implementation.

The replay module also exposes a CDC normalizer for reservation and seat-hold
tables. It maps `INSERT`, `UPDATE`, and `DELETE` to
`RESERVATION_CREATED`, `RESERVATION_UPDATED`, and `RESERVATION_RELEASED`,
respectively. The API route and event-bus shown here do not automatically
subscribe to or ingest a database changefeed.

## Reconnection

On reconnect, native SSE clients send the last frame ID as the
`Last-Event-ID` header. The endpoint replays retained events with greater
cursors, then attaches the connection to live delivery. Since browser
`EventSource` does not allow setting arbitrary request headers, an application
can seed its first connection using the supported `lastEventId` query
parameter; subsequent automatic reconnects use the browser-managed
`Last-Event-ID`.

If the server reports `resync_required`, the cursor is malformed, expired, or
ahead of that process's current stream. The event has no ID, so it does not
advance the browser-managed last event ID. The endpoint provides no snapshot
fallback or cursor-reset event.

## Usage examples

With `curl`, pass a cursor on a reconnect. `-N` disables curl's output
buffering:

```bash
# Initial connection
curl -N -H "Accept: text/event-stream" \
  "https://example.com/api/reservations/events?venueId=venue-seattle-01"

# Reconnect from cursor 42 after the prior connection closes
curl -N -H "Accept: text/event-stream" \
  -H "Last-Event-ID: 42" \
  "https://example.com/api/reservations/events?venueId=venue-seattle-01"
```

Browser example, seeding the first connection at cursor `42`:

```javascript
const source = new EventSource(
  "/api/reservations/events?venueId=venue-seattle-01&lastEventId=42",
);

source.addEventListener("connected", (event) => {
  console.info("Availability stream connected", JSON.parse(event.data));
});

source.addEventListener("availability", (event) => {
  console.info("Availability update", {
    cursor: event.lastEventId,
    data: JSON.parse(event.data),
  });
});

source.addEventListener("desk_expired", (event) => {
  console.info("Desk hold expired", JSON.parse(event.data));
});

source.addEventListener("resync_required", (event) => {
  console.warn("Stream cursor needs resynchronization", JSON.parse(event.data));
});
```

The browser reconnects an `EventSource` automatically and sends its last
event ID. Close it with `source.close()` when the consumer no longer needs the
stream.
