# Mesh WebSocket Reconnect Guard (`useMeshDataChannels.ts` & `party/server.ts`)

Documents the connection state machine, exponential backoff schedule with jitter, and client/server guards in `src/hooks/useMeshDataChannels.ts` and `party/server.ts` that prevent duplicate WebSocket handshakes.

## 1. State Machine & Transitions

* **`IDLE`:** Initial state or post-teardown state with no active socket or retry timer.
* **`CONNECTING`:** Handshake in flight; concurrent connect requests coalesce or return early so only one handshake runs at a time.
* **`OPEN`:** Socket connected and active; resets retry attempt counter and clears pending backoff timers.
* **`BACKOFF_WAITING`:** Waiting for a single scheduled reconnect timer after a close or handshake failure.
* **`CLOSED`:** Intentionally stopped or superseded by a newer connection generation; ignores stale events.

### Key Transitions

* `IDLE -> CONNECTING` on connect (increments `generationId`, sets single-flight guard).
* `CONNECTING -> OPEN` on matching-generation open (clears handshake guard, resets attempt count).
* `CONNECTING -> BACKOFF_WAITING` or `OPEN -> BACKOFF_WAITING` on unexpected close/error (schedules single timer).
* `BACKOFF_WAITING -> CONNECTING` when retry timer fires.
* `Any -> CLOSED` on explicit disconnect/cleanup (cancels timer, bumps `generationId`).

## 2. Reconnect Backoff Schedule

* **Exponential Formula:** `delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt)` with default `baseDelayMs = 250` ms and `maxDelayMs = 15000` ms.
* **Jitter:** Applies bounded jitter (such as up to 20%, clamped non-negative) to prevent thundering-herd reconnects to `party/server.ts`.
* **Reset:** Resets `attempt = 0` upon reaching `OPEN` and passing connection stability checks.

## 3. Duplicate Handshake Prevention

* **Client Guard (`src/hooks/useMeshDataChannels.ts`):** Enforces single-flight handshake state, monotonic `generationId` checks on socket callbacks, and single active `retryTimerId`.
* **Server Guard (`party/server.ts`):** Deduplicates or replaces superseded connections for the same peer/session key and bounds rapid reconnect handshakes.
