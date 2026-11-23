# Reservation Availability Server-Sent Events (SSE) API

## Overview

The Reservation Availability Server-Sent Events (SSE) endpoint provides real-time, venue-scoped streaming notifications for desk holds, seat reservations, reschedulings, cancellations, and expirations. The stream delivers live signals that help clients refresh their availability views and timer states as changes occur across the venue; it is an informational notification channel and is not itself a concurrency-control mechanism.

The implementation is located in:

- [`src/app/api/reservations/events/route.ts`](../../src/app/api/reservations/events/route.ts) — Route handler, SSE stream lifecycle, and heartbeat dispatch.
- [`src/lib/reservations/event-bus.ts`](../../src/lib/reservations/event-bus.ts) — In-memory venue-keyed publish/subscribe event bus.
- [`src/app/reserve/[venueId]/reservation-client.tsx`](../../src/app/reserve/[venueId]/reservation-client.tsx) — Floorplan client subscribing to live availability.
- [`src/hooks/useDeskReservationCountdown.ts`](../../src/hooks/useDeskReservationCountdown.ts) — Desk reservation countdown timer hook subscribing to expiration events.
- [`src/lib/reservations/deskReservationCountdown.ts`](../../src/lib/reservations/deskReservationCountdown.ts) — Atomic desk hold acquisition, renewal, and release engine.
- [`src/lib/reservations/redisKeyspaceSubscriber.ts`](../../src/lib/reservations/redisKeyspaceSubscriber.ts) — Redis keyspace and timer-wheel expiration dispatcher.
- [`src/lib/redis/keyspaceNotifications.ts`](../../src/lib/redis/keyspaceNotifications.ts) — Keyevent expiration pattern subscriber.
- [`src/app/api/reservations/book/route.ts`](../../src/app/api/reservations/book/route.ts) — Single booking confirmation event publisher.
- [`src/app/api/reservations/recurring-book/route.ts`](../../src/app/api/reservations/recurring-book/route.ts) — Recurring booking confirmation event publisher.
- [`src/app/api/bookings/[bookingId]/route.ts`](../../src/app/api/bookings/[bookingId]/route.ts) — Booking rescheduling event publisher.
- [`src/app/api/webhooks/venue-cancel/route.ts`](../../src/app/api/webhooks/venue-cancel/route.ts) — Venue cancellation event publisher.
- [`src/__tests__/api/reservations/events.test.ts`](../../src/__tests__/api/reservations/events.test.ts) — Route unit and integration test suite.

The route is configured with:

```typescript
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
```

---

## Endpoint and Query Parameter Contract

```http
GET /api/reservations/events?venueId=<venue-id>
```

A valid request opens a persistent HTTP Server-Sent Events connection subscribed to the specified venue.

### Query Parameters

| Parameter | Type   | Required | Description                                                                                                              |
| --------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------ |
| `venueId` | string | Yes      | Identifier of the venue whose availability stream to subscribe to. Must be a non-empty string after whitespace trimming. |

When constructing the request URL in JavaScript, always URL-encode the `venueId`:

```javascript
const url = `/api/reservations/events?venueId=${encodeURIComponent(venueId)}`;
```

The route reads only the `venueId` query parameter. No additional query parameters are supported or recognized.

### Error Response

If `venueId` is missing, empty, or consists solely of whitespace, the route immediately returns HTTP `400 Bad Request` as JSON without establishing a stream:

```http
HTTP/1.1 400 Bad Request
Content-Type: application/json
```

```json
{
  "error": "Missing required query parameter: venueId"
}
```

---

## Successful Response and HTTP Headers

When a valid `venueId` is provided, the route returns HTTP `200 OK` with a streamed response body (`ReadableStream<Uint8Array>`):

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

### Purpose of Headers

- **`Content-Type: text/event-stream; charset=utf-8`**: Identifies the stream as a standard Server-Sent Events resource according to the HTML specification.
- **`Cache-Control: no-cache, no-transform`**: Instructs intermediate caches, proxies, and CDNs not to cache event chunks and prevents data transformations (such as chunk compression or re-framing) that could delay real-time delivery.
- **`Connection: keep-alive`**: Requests that the underlying TCP transport remain open for continuous streaming.
- **`X-Accel-Buffering: no`**: Informs Nginx and compatible reverse proxies to disable response buffering so events are flushed to the client immediately upon generation.

> [!NOTE]
> While anti-buffering and caching headers signal proxies to avoid delaying frames, end-to-end streaming latency depends on the deployment environment, intermediary load balancers, and corporate proxy configurations.

---

## SSE Frame Format

The route encodes every message using standard SSE framing:

```text
event: <event-name>
data: <JSON-payload>

```

Each frame consists of an `event:` line containing the SSE event name, a `data:` line containing a serialized JSON payload string, and a terminating double newline (`\n\n`).

Key framing characteristics:

- The SSE event name specified on the `event:` line is separate from any `type` property contained within the parsed JSON payload.
- The route does not output SSE `id:` fields or custom `retry:` directives. Clients rely on standard browser-native `EventSource` reconnection intervals.

---

## Canonical Event Contract

The route emits events under four canonical SSE event names: `connected`, `heartbeat`, `availability`, and `desk_expired`.

```
                  +----------------------------------------+
                  |  Shared Event Bus (publishVenueAvail)  |
                  +----------------------------------------+
                                       |
                   +-------------------+-------------------+
                   |                                       |
         isExpiration = true                     isExpiration = false
    (DESK_HOLD_EXPIRED, SEAT_HOLD_EXPIRED,                 |
     desk_reservation_expired)                             |
                   |                                       |
                   v                                       v
         event: desk_expired                      event: availability
```

### 1. `connected`

Emitted once immediately upon connection establishment as an initial handshake.

- **SSE Event Name:** `connected`
- **Dispatch Timing:** Sent as the first frame when the `ReadableStream` starts.
- **Payload Schema:**
  - `type` (string): Fixed value `"connected"`.
  - `venueId` (string): The requested venue identifier.
  - `timestamp` (string): ISO 8601 UTC timestamp generated by the route handler.

```text
event: connected
data: {"type":"connected","venueId":"venue-123","timestamp":"2026-11-21T10:00:00.000Z"}

```

### 2. `heartbeat`

Emitted periodically every **15 seconds** (`15_000` milliseconds) to help keep an otherwise idle connection active through intermediaries.

- **SSE Event Name:** `heartbeat`
- **Dispatch Timing:** Sent every 15 seconds via an active Node.js `setInterval`.
- **Payload Schema:**
  - `type` (string): Fixed value `"heartbeat"`.
  - `venueId` (string): The requested venue identifier.
  - `timestamp` (string): ISO 8601 UTC timestamp generated by the route handler.

```text
event: heartbeat
data: {"type":"heartbeat","venueId":"venue-123","timestamp":"2026-11-21T10:00:15.000Z"}

```

> [!NOTE]
> Periodic heartbeats provide regular activity on quiet streams to help keep connections active through intermediary reverse proxies, firewalls, and cloud load balancers. However, they do not guarantee against disconnections; actual idle timeouts, streaming behavior, and connection duration limits depend on the deployment and proxy configuration.
>
> [!IMPORTANT]
> The reservation stream uses a **15-second** heartbeat interval. Do not confuse this with the 30-second interval used by the general `/api/venues/updates` endpoint.

### 3. `availability`

All standard reservation, hold, rescheduling, and cancellation events are emitted under the SSE event name `availability`.

- **SSE Event Name:** `availability`
- **Event Bus Origin:** Published via `publishVenueAvailability(venueId, event)` in [`src/lib/reservations/event-bus.ts`](../../src/lib/reservations/event-bus.ts).
- **Common Event-Bus Attributes:**
  - The shared event bus attaches or overwrites `venueId` with the venue ID passed to `publishVenueAvailability`.
  - The shared event bus attaches or overwrites `timestamp` with `Date.now()` (numeric Unix epoch milliseconds).
  - Consequently, availability payloads carry numeric millisecond timestamps, unlike the ISO string timestamps in `connected` and `heartbeat` frames.
  - Optional fields like `availableSeats` and `crowdLevel` can appear when supplied by an upstream publisher or test harness, but are not universally present across all payloads.

#### Representative Event Types and Payloads

##### A. Desk Reservation Held (`desk_reservation_held`)

Published by [`src/lib/reservations/deskReservationCountdown.ts`](../../src/lib/reservations/deskReservationCountdown.ts) when a user places an atomic hold on a desk.

```text
event: availability
data: {"type":"desk_reservation_held","deskId":"desk-42","seatId":"desk-42","userId":"user_2abc...","userName":"Alex Doe","expiresAt":1795345200000,"remainingSeconds":300,"timestamp":1795344900000,"venueId":"venue-123"}

```

##### B. Seat Reserved (`seat_reserved`)

Published by [`src/app/api/reservations/book/route.ts`](../../src/app/api/reservations/book/route.ts) and [`src/app/api/reservations/recurring-book/route.ts`](../../src/app/api/reservations/recurring-book/route.ts) when a booking is confirmed.

```text
event: availability
data: {"type":"seat_reserved","seatId":"seat-14","seatNumber":"D-14","date":"2026-11-25","time":"09:00","duration":120,"venueId":"venue-123","timestamp":1795344900000}

```

##### C. Seat Rescheduled (`seat_rescheduled`)

Published by [`src/app/api/bookings/[bookingId]/route.ts`](../../src/app/api/bookings/[bookingId]/route.ts) when an existing reservation is moved to a new time or seat.

```text
event: availability
data: {"type":"seat_rescheduled","bookingId":"booking_789","seatId":"seat-18","date":"2026-11-26","time":"14:00","duration":60,"venueId":"venue-123","timestamp":1795344900000}

```

##### D. Desk Reservation Released (`desk_reservation_released`)

Published by [`src/lib/reservations/deskReservationCountdown.ts`](../../src/lib/reservations/deskReservationCountdown.ts) when a user explicitly releases an active hold before checkout.

```text
event: availability
data: {"type":"desk_reservation_released","deskId":"desk-42","seatId":"desk-42","userId":"user_2abc...","reason":"USER_RELEASED","timestamp":1795344900000,"venueId":"venue-123"}

```

##### E. Booking Cancelled by Operator (`booking_cancelled_by_operator`)

Published by [`src/app/api/webhooks/venue-cancel/route.ts`](../../src/app/api/webhooks/venue-cancel/route.ts) when an administrative cancellation or webhook event cancels a reservation.

```text
event: availability
data: {"type":"booking_cancelled_by_operator","bookingId":"booking_789","seatId":"seat-14","date":"2026-11-25","time":"09:00","cancelledAt":"2026-11-21T10:15:00.000Z","venueId":"venue-123","timestamp":1795344900000}

```

### 4. `desk_expired`

Dispatched when a desk hold lease expires. The route handler classifies incoming payloads with any of the following raw `type` values as expiration events:

- `DESK_HOLD_EXPIRED` (published by [`src/lib/reservations/event-bus.ts`](../../src/lib/reservations/event-bus.ts) and [`src/lib/redis/keyspaceNotifications.ts`](../../src/lib/redis/keyspaceNotifications.ts))
- `SEAT_HOLD_EXPIRED` (published by seat hold locks)
- `desk_reservation_expired` (published by [`src/lib/reservations/redisKeyspaceSubscriber.ts`](../../src/lib/reservations/redisKeyspaceSubscriber.ts))

#### Route Validation and Payload Normalization

- **Route Validation:** At the route level, the endpoint requires only that the payload is an object containing a non-empty string `type`. It does not enforce a complete event-specific schema for expiration events.
- **Event Bus Attributes:** When published via `publishVenueAvailability`, the shared event bus attaches or overwrites `venueId` (string) and `timestamp` (`Date.now()`, numeric Unix epoch milliseconds).
- **Producer-Supplied Fields:** Fields such as `deskId`, `seatId`, `reason`, and `source` are conventions supplied by relevant upstream producers (e.g., Redis keyspace subscribers and countdown timers); they are not universally enforced route requirements.
- **Type Normalization:**
  - If the incoming event type is `DESK_HOLD_EXPIRED` or `SEAT_HOLD_EXPIRED`, the payload retains its original `type` property.
  - If the incoming event type is `desk_reservation_expired`, the route handler normalizes the JSON payload's `type` property to `DESK_HOLD_EXPIRED`.

#### Representative Expiration Payload

- **SSE Event Name:** `desk_expired`
- **Fields in Typical Payloads:**
  - `type` (string): Normalized to `"DESK_HOLD_EXPIRED"` or `"SEAT_HOLD_EXPIRED"` by the route.
  - `venueId` (string): Attached/overwritten by `publishVenueAvailability`.
  - `timestamp` (number): Attached/overwritten by `publishVenueAvailability` as numeric Unix epoch milliseconds.
  - `deskId` (string, producer-supplied): Identifier of the expired desk.
  - `seatId` (string, producer-supplied): Identifier of the expired seat (defaults to `deskId` where not distinct).
  - `reason` (string, optional, producer-supplied): Reason for release (e.g. `"EXPIRED"`).
  - `source` (string, optional, producer-supplied): Expiration origin (e.g. `"redis_keyspace"`, `"in_memory_simulation"`).

```text
event: desk_expired
data: {"type":"DESK_HOLD_EXPIRED","deskId":"desk-42","seatId":"desk-42","reason":"EXPIRED","venueId":"venue-123","timestamp":1795344900000}

```

---

## Payload Validation and Filtering

The route handler validates incoming event payloads before queuing them to the active SSE stream:

1. **Payload Parsing:**
   - If the raw payload is a string, it is parsed via `JSON.parse`. If parsing fails, the frame is rejected.
   - If the raw payload is already a JavaScript object (not null and not an array), it is accepted.
   - Arrays, primitive types (`number`, `boolean`, `undefined`), `null`, and unparseable strings are discarded.
2. **Type Requirement:**
   - The parsed payload must contain a `type` property that is a non-empty string (`typeof payloadObj.type === "string" && payloadObj.type.trim() !== ""`).
   - If `type` is missing, numeric, or empty, the payload is silently dropped.
3. **Resilience:**
   - Invalid or unusable payloads are ignored without throwing exceptions or terminating the SSE stream. Subsequent valid messages continue to be processed normally.
   - The route handler does not validate a strict schema for every event-specific property beyond requiring an object with a valid `type` string.

---

## Client Integration and Reconnection

Browser applications consume the stream using the standard Web `EventSource` API.

### JavaScript Client Example

```javascript
/**
 * Connects to the venue reservation SSE stream.
 * @param {string} venueId - Venue identifier
 * @param {object} callbacks - Event callback handlers
 * @returns {() => void} Disconnect cleanup function
 */
function subscribeToVenueReservations(venueId, callbacks = {}) {
  const url = `/api/reservations/events?venueId=${encodeURIComponent(venueId)}`;
  const eventSource = new EventSource(url);

  // 1. Initial connection handshake
  eventSource.addEventListener("connected", (event) => {
    try {
      const data = JSON.parse(event.data);
      console.log(
        "[SSE] Connected to venue stream:",
        data.venueId,
        "at",
        data.timestamp,
      );
      callbacks.onConnected?.(data);
    } catch (err) {
      console.error("[SSE] Failed to parse connected payload:", err);
    }
  });

  // 2. Availability updates (bookings, releases, holds, reschedules)
  eventSource.addEventListener("availability", (event) => {
    try {
      const data = JSON.parse(event.data);
      callbacks.onAvailability?.(data);
    } catch (err) {
      console.error("[SSE] Failed to parse availability payload:", err);
    }
  });

  // 3. Desk hold expirations
  eventSource.addEventListener("desk_expired", (event) => {
    try {
      const data = JSON.parse(event.data);
      callbacks.onDeskExpired?.(data);
    } catch (err) {
      console.error("[SSE] Failed to parse desk_expired payload:", err);
    }
  });

  // 4. Periodic keep-alive heartbeats (15s interval)
  eventSource.addEventListener("heartbeat", (event) => {
    try {
      const data = JSON.parse(event.data);
      callbacks.onHeartbeat?.(data);
    } catch (err) {
      console.error("[SSE] Failed to parse heartbeat payload:", err);
    }
  });

  // 5. Connection error handler
  eventSource.onerror = (err) => {
    // Inspect readyState to determine connection status:
    // - EventSource.CONNECTING (0): Connection lost; browser attempting native reconnection
    // - EventSource.CLOSED (2): Connection permanently closed (e.g. fatal non-200 HTTP response or explicit close)
    if (eventSource.readyState === EventSource.CLOSED) {
      console.error("[SSE] Connection closed permanently:", err);
    } else {
      console.warn("[SSE] Stream interrupted; browser reconnecting:", err);
    }
    callbacks.onError?.(err);
  };

  // Return a cleanup function to close the stream when done
  return () => {
    eventSource.close();
  };
}
```

### Browser Reconnection Semantics

Browser-native `EventSource` connections manage connection state transitions through `readyState`:

- **`CONNECTING` (`0`):** The connection is being established, or a transient network disruption occurred and the browser is actively attempting to reconnect.
- **`OPEN` (`1`):** The streaming connection is active and processing incoming SSE frames.
- **`CLOSED` (`2`):** The connection is closed and the browser is not attempting to reconnect. This state occurs after an explicit `eventSource.close()` call or upon encountering a fatal connection failure, such as a non-200 HTTP response (e.g., HTTP `400 Bad Request` or an auth middleware redirect).

Operational considerations:

- **Transient Failures vs. Fatal Errors:** Transient network interruptions trigger automatic browser reconnection while in the `CONNECTING` state. However, fatal responses (such as a missing `venueId` parameter returning HTTP 400 or unauthenticated requests redirected by middleware) terminate the stream and transition to `CLOSED`, halting automatic retry attempts.
- **Retry Directives:** The server route does not emit a custom `retry:` directive; reconnection timing for recoverable errors follows the browser's default backoff schedule.
- **Explicit Termination:** Calling `eventSource.close()` immediately transitions `readyState` to `CLOSED` and stops any ongoing or pending reconnection attempts.
- **Tab Visibility Handling:** Following the pattern used in `ReservationClient`, when the document becomes visible (`document.visibilityState === "visible"`), clients can close the existing `EventSource` and instantiate a fresh connection to resynchronize after background idling.

---

## Existing Client Subscription Patterns

The WorkSphere frontend uses two distinct subscription patterns targeting this endpoint:

```
+-------------------------------------------------------------------------+
|                    GET /api/reservations/events                         |
+-------------------------------------------------------------------------+
                    |                                 |
                    | (availability)                  | (availability, desk_expired)
                    v                                 v
+---------------------------------------+ +-------------------------------+
|          ReservationClient            | |  useDeskReservationCountdown  |
|  - Floorplan & seat availability view | |  - Atomic checkout timer      |
|  - Triggers loadAvailability()        | |  - Checks deskId / seatId     |
|  - Tab visibility reset listener      | |  - Cross-tab BroadcastChannel |
+---------------------------------------+ +-------------------------------+
```

### 1. `ReservationClient`

Located in [`src/app/reserve/[venueId]/reservation-client.tsx`](../../src/app/reserve/[venueId]/reservation-client.tsx).

- **Subscribed Event:** Listens exclusively to the `availability` event.
- **Action:** Calls `loadAvailability()` upon receiving an `availability` event to re-fetch venue seats and redraw the floorplan.
- **Tab Visibility Reconnection:** Registers a `visibilitychange` listener. When the document becomes visible (`document.visibilityState === "visible"`), it explicitly closes the existing `EventSource` instance and creates a fresh connection.
- **Cleanup:** Closes the `EventSource` and removes the `visibilitychange` listener during React effect unmount.
- **Note:** `ReservationClient` does **not** subscribe to `desk_expired`. Desk expiration handling is delegated to the countdown timer hook.

### 2. `useDeskReservationCountdown`

Located in [`src/hooks/useDeskReservationCountdown.ts`](../../src/hooks/useDeskReservationCountdown.ts).

- **Subscribed Events:** Listens to **both** `desk_expired` and `availability`.
- **Action:**
  - Parses incoming JSON payloads from both events.
  - Checks whether the payload type is `DESK_HOLD_EXPIRED` or `SEAT_HOLD_EXPIRED`.
  - Verifies whether `payload.deskId` or `payload.seatId` matches the currently tracked `deskId`.
  - When matching: sets `isExpired: true`, sets `remainingSeconds: 0`, nullifies `expiresAt`, triggers `onExpire(deskId)`, and dispatches a cross-tab notification via `BroadcastChannel`.
- **Live Sync Indicator:** Uses `eventSource.onopen` and `eventSource.onerror` to toggle the hook's `isLiveSyncActive` state.
- **Cleanup:** Closes the `EventSource` instance and resets `isLiveSyncActive: false` on unmount or when `venueId`/`deskId` changes.

---

## Stream Cleanup and Process-Local Behavior

### Server-Side Cleanup Flow

When a client disconnects or navigates away, resources are cleaned up immediately via a central `cleanup()` callback, which can be triggered through two distinct pathways:

1. **Stream Cancellation:** When a reader cancels the stream consumption (e.g., `reader.cancel()` in consumer or test code), the `ReadableStream` invokes its `cancel()` callback, which calls `cleanup()`.
2. **Request Abort Signal:** When the client aborts the underlying HTTP request or drops the transport connection, `request.signal` emits an `"abort"` event, invoking the registered `onAbort` event listener which calls `cleanup()`.
3. **Controller Enqueue Failure:** If an external stream closure causes `controller.enqueue()` to throw, the caught exception also triggers `cleanup()`.

Both termination paths execute the same idempotent `cleanup()` function:

- **Timer Teardown:** The 15-second heartbeat timer is cancelled via `clearInterval(heartbeat)`.
- **Bus Unsubscription:** The listener registered with `subscribeVenueAvailability(venueId, listener)` is unregistered, removing the listener from the venue's active subscriber set.
- **Signal Listener Removal:** The `abort` event listener is removed from `request.signal`.
- **Idempotence:** An `isClosed` boolean flag ensures that teardown runs at most once, preventing double-unsubscription or timer leaks.

```typescript
const cleanup = () => {
  if (isClosed) return;
  isClosed = true;

  if (heartbeat !== null) {
    clearInterval(heartbeat);
    heartbeat = null;
  }

  if (unsubscribe !== null) {
    unsubscribe();
    unsubscribe = null;
  }

  request.signal.removeEventListener("abort", onAbort);
};
```

### Process-Local Event Bus Architecture Limitation

The event bus in [`src/lib/reservations/event-bus.ts`](../../src/lib/reservations/event-bus.ts) uses a Node.js process-local `Map<string, Set<Listener>>`:

```typescript
const venueListeners = new Map<string, Set<Listener>>();
```

> [!CAUTION]
> **Process-Local Scope and Multi-Instance Event Delivery:**
>
> - `venueListeners` is stored in process memory on the specific server instance running the route handler.
> - The in-memory event bus does not automatically broadcast events across separate server instances, worker processes, or serverless functions.
> - The existing Redis keyspace notification integration ([`src/lib/reservations/redisKeyspaceSubscriber.ts`](../../src/lib/reservations/redisKeyspaceSubscriber.ts)) handles expiration-event dispatch into the local event bus. However, it does not automatically provide cross-instance delivery for every reservation event (such as desk holds, seat reservations, reschedulings, or releases).
> - Cross-instance delivery requires explicitly integrating a shared event transport (such as Redis Pub/Sub or a dedicated message broker) into the relevant event publishers and SSE subscribers.

---

## Troubleshooting

| Symptom                                                | Probable Cause                                           | Diagnostic & Resolution                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **HTTP 400 Bad Request**                               | Missing or whitespace-only `venueId` query parameter.    | Inspect the request URL. Ensure `venueId` is provided and URL-encoded: `?venueId=${encodeURIComponent(id)}`.                                                                                                                                                                                                                                                            |
| **Connection never opens / HTTP 307 Redirect**         | Missing Clerk session cookie or authentication boundary. | Requests to `/api/reservations/events` without a valid Clerk session are intercepted by Clerk middleware and redirected (`307`) to `/sign-in`. Verify user authentication.                                                                                                                                                                                              |
| **Stream opens but no availability updates arrive**    | Mismatched venue ID or invalid payload structure.        | Verify that publishers call `publishVenueAvailability` with the exact same `venueId` string. Confirm that the payload contains a non-empty string `type`.                                                                                                                                                                                                               |
| **Desk expiration not detected in client**             | Client not listening for `desk_expired`, or ID mismatch. | Verify the client registers an event listener for `desk_expired`. Confirm that the payload's `deskId` or `seatId` matches the client's desk ID. Note that raw `desk_reservation_expired` events are normalized by the route to `DESK_HOLD_EXPIRED`.                                                                                                                     |
| **Frequent stream disconnects**                        | Reverse proxy or load balancer idle timeout.             | Verify that intermediary reverse proxies (e.g. Nginx, Cloudflare) support HTTP streaming and respect `X-Accel-Buffering: no` and `Cache-Control: no-cache`. Ensure proxy timeouts exceed the 15-second heartbeat interval.                                                                                                                                              |
| **Duplicate or stale events in UI**                    | Leaked `EventSource` instances across React re-renders.  | Ensure the component closes the previous `EventSource` before opening a new one and executes `eventSource.close()` during effect cleanup.                                                                                                                                                                                                                               |
| **Events received on one server node but not another** | Process-local in-memory event bus limitation.            | The in-memory event bus operates strictly within a single Node.js process. While Redis keyspace notifications dispatch expiration events into the local bus, general reservation events (holds, bookings, reschedules) do not cross instance boundaries without explicitly integrating a shared event transport into the relevant event publishers and SSE subscribers. |
