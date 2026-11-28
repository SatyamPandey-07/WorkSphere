# Deterministic Conflict Surfacing & Idempotent DTN Replay Guarantees

This document describes the replay deduplication, conflict resolution states, and retry backoff observability implemented across `DtnBundleInbox` (`src/network/dtnBundleInbox.ts`) and `SyncQueue` (`src/worker/bookingSync/SyncQueue.ts`).

## 1. Idempotent DTN Bundle Replay (`DtnBundleInbox`)

`DtnBundleInbox` reassembles fragmented DTN bundles (`DtnFragment`) while guaranteeing that duplicate or out-of-order fragment replays do not re-emit an already-assembled bundle within its TTL window.

### Replay & Expiration Semantics

1. **Fragment Validation**: `ingestFragment(fragment, nowMs)` rejects fragments with an empty `bundleId`, `totalFragments < 1`, or out-of-range `fragmentIndex` (`< 0` or `>= totalFragments`), returning `null`.
2. **TTL Eviction**: Before processing, `evictExpired(safeNow)` removes any `pending` or `completedExpiry` entries where `safeNow >= expiresAtMs`. The default TTL is `DEFAULT_DTN_BUNDLE_TTL_MS` (`60_000` ms) unless overridden by `fragment.ttlMs` or `DtnBundleInboxOptions.defaultTtlMs`.
3. **Completed-Bundle Guard**: If `completedExpiry.has(fragment.bundleId)` is true, the bundle was already assembled within its TTL; `ingestFragment` immediately returns `null` without re-buffering fragments.
4. **Assembly & TTL Recording**: Once `entry.fragments.size === entry.totalFragments`, the payload chunks are concatenated in index order (`0 .. totalFragments - 1`), the entry is deleted from `pending`, and `completedExpiry.set(fragment.bundleId, entry.expiresAtMs)` records the replay guard until expiration.

### Inspection Helpers

- `hasPendingBundle(bundleId, nowMs)` — returns whether a bundle is currently accumulating fragments.
- `hasCompletedBundle(bundleId, nowMs)` — returns whether a bundle is within its post-assembly deduplication TTL.
- `getPendingCount(nowMs)` — returns the count of active in-flight bundles after evicting expired entries.
- `evictExpired(nowMs)` — returns the list of `bundleId`s evicted from `pending`.

---

## 2. Deterministic Conflict Surfacing & Retry Backoff (`SyncQueue`)

`SyncQueue` processes `BookingDraft` entries sequentially when online and maintains per-draft `DraftRetryMetadata` in `retryState`:

```ts
export interface DraftRetryMetadata {
  draftId: string;
  attempts: number;
  nextAttemptAtMs: number;
  status: "pending" | "retry" | "conflict" | "dead_letter";
  lastError?: string;
}
```

### Conflict & Retry State Machine

| Status | Trigger | `nextAttemptAtMs` | Queue / UI Behavior |
| --- | --- | --- | --- |
| `pending` | Initial draft state before a failed sync attempt | — | Eligible for immediate `processQueue()` execution. |
| `retry` | Sync fails (non-conflict) with `nextAttempts < maxRetries` (default `5`) | `Date.now() + calculateBackoff(nextAttempts - 1)` | Skipped by `processQueue()` until `nextAttemptAtMs <= nowMs`. |
| `conflict` | `ConflictResolver.resolve(draft, serverState)` returns `requiresUserInput === true` | `Number.POSITIVE_INFINITY` | Draft is retained in `DraftStore`; dispatches `CustomEvent("booking_sync_conflict", { detail: mergeResult })` on `window` for deterministic UI resolution. |
| `dead_letter` | `nextAttempts >= maxRetries` | `Number.POSITIVE_INFINITY` | Skipped by `processQueue()`; `lastError` is set to `current?.lastError ?? "Max sync retries exceeded"`. |

### Observability & Idempotency Guarantees

- **Per-Draft Inspection**:
  - `syncQueue.getRetryMetadata(draftId)` returns the current `DraftRetryMetadata` (`attempts`, `nextAttemptAtMs`, `status`, `lastError`).
  - `syncQueue.getDeadLetterDrafts()` returns all drafts currently in `"dead_letter"` status.
- **UI Event Notifications**:
  - On conflict: dispatches `booking_sync_conflict` with `mergeResult` as `detail`.
  - On successful offline draft creation (`draft.id.startsWith("draft-")` or `404` fallback): dispatches `worksphere:booking-draft-synced` with `{ draftId, venueId }`.
- **Idempotent Server Updates**: `PUT /api/bookings/${draft.id}` includes `"Idempotency-Key": "booking-sync-${draft.id}-v${(serverState.version || 0) + 1}"` so retried requests after transient network drops do not apply duplicate mutations.
