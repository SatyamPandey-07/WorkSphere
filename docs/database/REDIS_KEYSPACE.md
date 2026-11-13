# Redis Keyspace & Invalidation Reference

This page records Redis keys and expiry behavior verified in the current code. It deliberately separates persistent Redis keys from in-process timer identifiers and calls out requested conventions that are not implemented, so that operators do not build monitoring around imaginary keys.

## 1. Active Redis key families

| Key pattern | Data structure | TTL / lifecycle | Owner |
|---|---|---|---|
| `desk:reservation:{venueId}:{deskId}` | String value containing the hold payload | Default 300 seconds; caller TTL is clamped to 10–600 seconds. Redis `SET ... EX` sets expiry. | `src/lib/reservations/deskReservationCountdown.ts` |
| `worksphere:ratelimit:{namespace}:{identity}` | Sorted Set for sliding-window requests; Hash for token-bucket state (fields `tokens`, `lastRefill`) | Sliding window expires after roughly two configured windows; token bucket expiry is at least two windows and may be extended to cover the next refill. | `src/lib/rateLimit/limiters/slidingWindowLimiter.ts`, `src/lib/rateLimit/stores/redisStore.ts` |
| `worksphere:ratelimit:{identifier}` | Sorted Set | Legacy compatibility implementation uses the configured request window as TTL. | `src/lib/rateLimit.ts` |

The reservation value is owned through the `getDeskReservationKey(venueId, deskId)` helper. Acquire, release, and PTTL inspection use Lua scripts so a hold is not managed by a client-side read/modify/write sequence.

### Reservation TTL bounds

- Default TTL: 300 seconds (5 minutes).
- Minimum accepted TTL: 10 seconds.
- Maximum accepted TTL: 600 seconds (10 minutes).
- The stored payload includes the owner and expiry metadata used by the hold flow.
- A process-local timer is also registered as a fallback for REST-only, serverless, or unavailable keyspace-notification environments.

## 2. Reservation key events and notification channels

The Redis keyevent pattern used for expiry notifications is:

- `__keyevent@*__:expired` — Redis publishes the expired key name as the message.
- `__keyevent@*__:del` — subscribed by the compatibility subscriber for explicit deletion events.

The primary `RedisKeyspaceNotificationManager` configures `notify-keyspace-events` with `Ex` (keyevent + expired) and pattern-subscribes to the expiry channel. Some compatibility code also subscribes to the delete channel; receiving delete events additionally requires Redis to enable the `g` event class. Managed Redis providers may disallow `CONFIG SET`, so configuration must be checked at the provider rather than assumed.

Reservation key parsing recognizes prefixes including:

- `desk:reservation:{venueId}:{deskId}`
- `seat:hold:{venueId}:{seatId}`
- `desk:hold:{venueId}:{deskId}`

The `seat:hold` key shown by the notification manager is also used as an in-process simulated-timer identifier; the current desk countdown Redis writer's canonical key is `desk:reservation:{venueId}:{deskId}`.

## 3. Event propagation and payloads

Key expiry is translated into application availability events rather than being treated as an application-owned Redis Pub/Sub topic.

The reservation notification path dispatches an event through the in-process event bus and `publishVenueAvailability(venueId, event)`, which feeds the venue availability stream. Expiration payloads contain the venue ID, desk/seat ID, event type (for example `DESK_HOLD_EXPIRED`), source (`redis_keyspace` or `in_memory_simulation`), and timestamp.

The desk countdown engine also emits hold lifecycle events:

- `desk:reservation:held`
- `desk:reservation:released`
- `desk:reservation:expired`

These are application EventBus event names. They are not Redis Pub/Sub channel names. Explicit release publishes the release event in the application path; expiry notifications and the local timer wheel are fallback mechanisms for automatic expiry.

## 4. Cache invalidation

### Desk hold release or expiry

1. The reservation service derives the exact key with `getDeskReservationKey`.
2. Explicit release executes the atomic release Lua script and cancels the fallback timer after a successful release.
3. Redis expiry emits the keyevent notification when the provider has expiry notifications enabled.
4. The subscriber parses the venue and desk IDs and broadcasts availability to connected clients.
5. The in-memory fallback timer covers deployments where TCP Redis keyspace subscriptions are unavailable.

### Venue search cache

The venue search response uses HTTP caching headers and ETags derived from the latest venue timestamp for a bounding box. The verified search/cache path does not establish a Redis key named `venue:search:{hash}`; do not add manual Redis invalidation for that name without first implementing the cache.

### Session storage

No application-owned Redis `session:{userId}` key with a seven-day TTL was found in the inspected implementation. Authentication/session lifecycle is handled by Clerk, not by the documented reservation Redis keyspace.

## 5. Rate-limit data is not a venue cache

Rate-limit keys share the `worksphere:ratelimit:` namespace but use different Redis data types according to algorithm:

- Sliding window: sorted-set members represent request timestamps; old members are pruned atomically.
- Token bucket: a hash stores the token balance and last-refill timestamp.
- The in-memory fallback store is process-local and does not create Redis keys.

Do not delete a caller's rate-limit key as a way to invalidate venue/search content.

## 6. Operational checklist

- Confirm the provider supports keyevent notifications and the required event classes.
- Keep reservation TTLs within the 10–600 second bounds and use the shared key helper; do not hand-build variants.
- Treat process-local timer wheels as a fallback, not a distributed source of truth.
- Inspect the actual key prefix and data type before issuing manual Redis commands.
- When adding a new key family, document its owning module, structure, TTL, invalidation event, and fallback behavior in this file.
- If the reservation key schema or notification events change, update the tests and this guide in the same pull request.

## 7. Source references

- `src/lib/reservations/deskReservationCountdown.ts`
- `src/lib/reservations/redisKeyspaceSubscriber.ts`
- `src/lib/redis/keyspaceNotifications.ts`
- `src/lib/reservations/event-bus.ts`
- `src/lib/rateLimit/limiters/slidingWindowLimiter.ts`
- `src/lib/rateLimit/stores/redisStore.ts`
- `src/lib/redis.ts`

Additional design detail: [Atomic desk reservation countdown and Redis keyspace](../architecture/atomic-desk-reservation-countdown-redis-keyspace.md).
