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

## 4. Example Scoped Capability Tokens

### Metrics & Heartbeat Token

``json
{\n  "sub": "gateway:mum-bhandup-01",\n  "gatewayId": "mum-bhandup-01",\n  "kid": "gw-mum-01-key-v1",\n  "scopes": [\n    "telemetry:metrics:write",\n    "gateway:heartbeat:write"\n  ],\n  "iat": 1795758000,\n  "exp": 1795761600,\n  "jti": "tok_9f8e7d6c5b4a3210"\n}\n``n
### Trace & Metrics Token During Dual-Key Rotation

``json
{\n  "sub": "gateway:mum-bhandup-01",\n  "gatewayId": "mum-bhandup-01",\n  "kid": "gw-mum-01-key-v2",\n  "scopes": [\n    "telemetry:metrics:write",\n    "telemetry:traces:write"\n  ],\n  "rotationEpoch": 2,\n  "iat": 1795761000,\n  "exp": 1795764600,\n  "jti": "tok_1234567890abcdef"\n}\n``