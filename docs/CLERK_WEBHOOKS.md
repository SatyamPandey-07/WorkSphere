# Clerk Webhooks (`src/app/api/webhooks/clerk/route.ts`)

`src/app/api/webhooks/clerk/route.ts` handles inbound Clerk webhook requests authenticated via Svix headers (`svix-id`, `svix-timestamp`, `svix-signature`), deduplicates repeated deliveries, and enforces monotonic ordering invariants so stale or out-of-order events cannot overwrite newer state or resurrect deleted/tombstoned records.

## 1. Svix Delivery Deduplication

Clerk delivers webhooks at least once and may retry on network timeouts, `5xx` responses, or concurrent worker deliveries:

1. **Signature & Timestamp Verification:** Verifies incoming payloads using `svix-id`, `svix-timestamp`, and `svix-signature` before mutating application state.
2. **Idempotency Key (`svix-id`):** Checks whether `svix-id` has already been processed or is currently in flight before applying mutations.
3. **Duplicate Short-Circuit:** Returns a `2xx` response for already-processed `svix-id` deliveries without re-executing downstream side effects.

## 2. Tombstone Ordering Invariants

Out-of-order or delayed deliveries around deletions can cause stale updates to overwrite newer state or resurrect removed entities:

* **Monotonic Event Ordering:** Compares incoming event timestamps/versions against the latest applied state for each entity and skips older events.
* **Tombstone Precedence:** Once a tombstone is recorded at timestamp `T_del`, any event with `T_evt <= T_del` (such as a delayed update retry) cannot overwrite or un-delete the record.
* **Strict Forward Progression:** Only a strictly newer event (`T_evt > T_del`) with valid lifecycle state can advance past an existing tombstone; equal or earlier timestamps never cause a tombstone regression.
