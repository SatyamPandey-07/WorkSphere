# Telemetry Gateway Auth Registry (`gatewayAuthRegistry.ts`)

`src/lib/telemetry/gatewayAuthRegistry.ts` manages per-gateway credentials, enforces scoped telemetry capabilities, coordinates zero-downtime dual-key rotation, and handles credential revocation across edge and venue telemetry gateways.

## 1. Enrollment Flow

Each telemetry gateway is enrolled with a unique `gatewayId`, an initial active signing key, and an explicit set of scoped capability permissions:

1. **Identity & Scope Binding:** Binds `gatewayId` to allowed telemetry scopes (such as `telemetry:metrics:write`, `telemetry:logs:write`, `telemetry:traces:write`, or `gateway:heartbeat:write`) and optional venue constraints.
2. **Primary Credential Issuance:** Stores an initial credential (`keyId`, key material, `issuedAtMs`, `expiresAtMs`, `status: 'active'`) for `gatewayId`.
3. **Scoped Token Verification:** Validates capability tokens against `gatewayId`, `keyId`, required scopes, token expiry, and active/grace key state.

## 2. Dual-Key Rotation Flow

To rotate credentials without dropping in-flight telemetry batches during propagation or clock skew:

1. **Stage Replacement Key:** Promotes a new key to `'active'` while moving the prior active key to `'grace'` until `graceUntilMs`.
2. **Dual-Key Overlap Window:** Accepts tokens signed with either the `'active'` or `'grace'` key while both remain unrevoked and within TTL.
3. **Retire Outgoing Key:** Transitions the superseded key to `'retired'` after `graceUntilMs` or rotation completion so stale keys are rejected.

## 3. Revocation Flow

When a gateway is retired or a credential is compromised:

1. **Key or Gateway Revocation:** Immediately marks a target `keyId` (or all keys for `gatewayId`) as `'revoked'`.
2. **Immediate Rejection:** Rejects subsequent capability tokens referencing a revoked `keyId` or `gatewayId` with an explicit revocation reason.
3. **Audit Recording:** Records enrollment, rotation, and revocation transitions for operational inspection.

## 4. `lastUsedAt` Update Semantics

`GatewayAuthRegistry.verifyCredential()` updates usage metadata only after the
credential passes lifecycle, secret, and required-scope checks. Failed or
rejected verification does not count as use. The update writes both
`lastUsedAtMs` (epoch milliseconds) and `lastUsedAt` (an ISO 8601 UTC string)
onto the in-memory credential record synchronously, before returning the
successful verification result.

An optional `lastUsedFlushIntervalMs` constructor option throttles repeated
updates. Its default is `0`, which disables throttling. When configured above
zero, a successful verification within that interval of a previous recorded
use leaves the previous timestamp unchanged and does not invoke the listener.

If `onLastUsedRecorded` is configured, the registry snapshots the updated
record and invokes the listener in a `queueMicrotask`. The listener is not
awaited by `verifyCredential()`, so verification returns without waiting for
listener work. A synchronous listener exception or rejected listener promise
is swallowed; the implementation contains no retry or error logging. The
in-memory timestamp remains updated even if the listener fails.

## 5. Consistency and Ingestion Boundaries

The in-memory fields are current when a successful `verifyCredential()` call
returns, except when the optional flush interval suppresses an update. A
consumer of `onLastUsedRecorded` may observe the change later because it runs
in a microtask; a failed listener may leave that consumer's copy stale
indefinitely. The registry itself does not persist gateway credentials or
`lastUsedAt` to Prisma. Its records are held in a process-local `Map`, so they
are not a durable, cross-process audit log. A process restart also loses the
registry's usage metadata.

Treat telemetry ingestion and usage metadata as separate outcomes. The batch
route persists readings through `prisma.venueTelemetry.createMany()` and
returns `201` after that write succeeds. That response does not establish that
an `onLastUsedRecorded` listener ran or persisted metadata. In the inspected
sources, the route calls `defaultGatewayRegistry.authenticateToken()`, but
[`gatewayAuthRegistry.ts`](../../src/lib/telemetry/gatewayAuthRegistry.ts)
defines `GatewayAuthRegistry.verifyCredential()` and does not define that
default registry or an `authenticateToken()` method. The available sources
therefore do not confirm a wiring path from this route to the last-used
listener; do not infer one from a successful ingestion response.

## 6. Auditing and Operational Use

There is no gateway-credential Prisma model, `lastUsedAt` database column, or
gateway-to-credential Prisma relationship in
[`schema.prisma`](../../prisma/schema.prisma). The schema's `lastUsedAt` fields
belong to `WebAuthnCredential` and `PushSubscription`, not gateway
credentials; `VenueTelemetry` has `recordedAt`, not gateway usage metadata.
Consequently, there is no Prisma query for recently used or stale gateway
credentials, and the registry has no method to enumerate all records.

For a credential whose IDs are already known, the in-memory registry exposes
`getCredentialRecord(gatewayId, keyId)`. Apply audit thresholds to
`lastUsedAtMs` as an epoch-millisecond number; the boundaries below include
the cutoff in “recent” and exclude it from “stale.” The example treats
timestamps later than the audit's `nowMs` as a clock anomaly rather than
recent use:

```ts
const nowMs = Date.now();
const cutoffMs = nowMs - 30 * 24 * 60 * 60 * 1000;
const record = registry.getCredentialRecord(gatewayId, keyId);
const lastUsedAtMs = record?.lastUsedAtMs;

const recentlyUsed =
  lastUsedAtMs !== undefined &&
  lastUsedAtMs >= cutoffMs &&
  lastUsedAtMs <= nowMs;
const stale =
  lastUsedAtMs !== undefined &&
  lastUsedAtMs < cutoffMs;
const unobserved =
  record !== undefined &&
  lastUsedAtMs === undefined;
```

`unobserved` means this in-memory record has no recorded successful
verification; it is not proof the credential has never been used. A process
restart, a different process-local registry, or a failed external listener can
make metadata unavailable or stale. A timestamp can also lag usage when
`lastUsedFlushIntervalMs` suppresses an update. Use `lastUsedAt` only as a
best-effort operational signal, not as the sole basis for security auditing or
automatic inactivity revocation. Timestamps represent UTC instants; compare
epoch values or parse the ISO string as an instant, and do not apply local-time
conversions to the threshold. The cutoff above is inclusive for
`recentlyUsed` and exclusive for `stale`; records with no timestamp are
`unobserved`, and future timestamps are excluded from both classifications.

Relevant source and tests:

- [`gatewayAuthRegistry.ts`](../../src/lib/telemetry/gatewayAuthRegistry.ts) — verification, update throttling, queued listener, and listener error handling.
- [`gatewayCredentialRegistry.test.ts`](../../src/__tests__/api/gatewayCredentialRegistry.test.ts) — **“records lastUsedAt on successful verification without blocking or updating on failed checks”** verifies immediate in-memory fields and deferred listener invocation.
- [`route.ts`](../../src/app/api/telemetry/batch/route.ts) — batch persistence and response behavior.
- [`telemetryBatch.test.ts`](../../src/__tests__/api/telemetryBatch.test.ts) — **“persists valid batch of up to 100 sensor readings with single prisma.venueTelemetry.createMany call”** and **“returns 500 when database insertion fails”** cover ingestion persistence, not registry metadata.
- [`telemetryGatewayAuth.test.ts`](../../src/__tests__/api/telemetryGatewayAuth.test.ts) — authentication rejection and request ordering coverage; it does not verify last-used listener persistence.

## 7. Example Scoped Capability Tokens

### Metrics & Heartbeat Token

```json
{
  "sub": "gateway:mum-bhandup-01",
  "gatewayId": "mum-bhandup-01",
  "kid": "gw-mum-01-key-v1",
  "scopes": [
    "telemetry:metrics:write",
    "gateway:heartbeat:write"
  ],
  "iat": 1795758000,
  "exp": 1795761600,
  "jti": "tok_9f8e7d6c5b4a3210"
}
```
### Trace & Metrics Token During Dual-Key Rotation

```json
{
  "sub": "gateway:mum-bhandup-01",
  "gatewayId": "mum-bhandup-01",
  "kid": "gw-mum-01-key-v2",
  "scopes": [
    "telemetry:metrics:write",
    "telemetry:traces:write"
  ],
  "rotationEpoch": 2,
  "iat": 1795761000,
  "exp": 1795764600,
  "jti": "tok_1234567890abcdef"
}
```
