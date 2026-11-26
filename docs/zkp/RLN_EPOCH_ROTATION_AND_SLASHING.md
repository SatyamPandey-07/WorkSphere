# RLN Epoch Key Rotation Window & Double-Spend Slashing Invariants

This specification documents the zero-downtime epoch key rotation window, exact UTC midnight boundary semantics, and Shamir linear secret recovery invariants implemented in [`src/features/zkp/rlnSlasherGuard.ts`](../../src/features/zkp/rlnSlasherGuard.ts).

---

## 1. Finite Field & Epoch Timing Constants

| Constant | Value | Purpose |
| :--- | :--- | :--- |
| `DEFAULT_RLN_PRIME` | `21888242871839275222246405745257275088548364400416034343698204186575808495617n` | BN254 scalar field prime $p$ over which RLN polynomials are evaluated. |
| `MS_PER_UTC_DAY` | `86_400_000` | Number of milliseconds in a canonical UTC day (`24 * 60 * 60 * 1000`). |
| `DEFAULT_MIDNIGHT_ROLLOVER_SKEW_MS` | `2_000` (`2s`) | Default post-midnight rollover overlap grace window (`midnightRolloverSkewMs`). |

---

## 2. Linear RLN Share & Secret Recovery Mathematics

Each RLN identity secret $a_0 \in \mathbb{F}_p$ is bound to a per-epoch linear polynomial $f(x) = (a_0 + a_1 x) \bmod p$, where $a_1 \in \mathbb{F}_p$ is an ephemeral epoch slope and $x \in \mathbb{F}_p$ represents the message signal hash.

### 2.1 Share Evaluation (`evaluateLinearRlnShare`)

$$y = \bigl((a_0 \bmod p) + ((a_1 \bmod p) \cdot (x \bmod p)) \bmod p\bigr) \bmod p$$

All modular reductions use `modPositive(value, modulus)` so negative intermediate remainders normalize into $[0, p - 1]$.

### 2.2 Secret Recovery from Two Distinct Shares (`recoverSecretFromShares`)

Given two shares $(x_1, y_1)$ and $(x_2, y_2)$ in the same `(epoch, nullifier)` bucket with $x_1 \not\equiv x_2 \pmod p$:

1. Normalize coordinates modulo $p$: $x_1, y_1, x_2, y_2 \in [0, p - 1]$.
2. Compute $\Delta x = (x_2 - x_1) \bmod p$. If $\Delta x = 0$, recovery throws `"Cannot recover secret from identical x coordinates"`.
3. Compute the modular multiplicative inverse $(\Delta x)^{-1} \bmod p$ via the extended Euclidean algorithm (`modInverse`). Throws `"Modular inverse does not exist for non-coprime inputs"` if $\gcd(\Delta x, p) \neq 1$.
4. Reconstruct the constant intercept $a_0 = f(0)$ by Lagrange interpolation:
   $$a_0 = \bigl((y_1 x_2 \bmod p) - (y_2 x_1 \bmod p)\bigr) \cdot (\Delta x)^{-1} \bmod p$$

---

## 3. Double-Spend Slashing Invariants (`RlnSlasherGuard.submitShare`)

`RlnSlasherGuard` partitions shares by composite bucket key:

```text
bucketKey = `${String(effectiveEpoch)}::${nullifier}`
```

For each incoming `RlnShareInput` (`{ epoch, nullifier, x, y }`), coordinates are normalized modulo `this.fieldPrime` and evaluated against the bucket in strict order:

| Condition | `status` | `allowed` | `recoveredSecret` | Invariant / Side Effect |
| :--- | :--- | :--- | :--- | :--- |
| Bucket already exists in `slashedSecrets` | `'slashed'` | `false` | Cached `bigint` secret | Idempotently rejects further submissions for the slashed nullifier in that epoch. |
| Existing share has `prev.x === x && prev.y === y` | `'duplicate_share'` | `false` | `undefined` | Rejects exact replay without leaking or reconstructing $a_0$. |
| Existing share has `prev.x !== x` | `'slashed'` | `false` | Recovered $a_0$ (`bigint`) | Recovers $a_0$ via `recoverSecretFromShares`, appends share, and caches $a_0$ in `slashedSecrets`. |
| First share for `(effectiveEpoch, nullifier)` | `'accepted'` | `true` | `undefined` | Stores `{ x, y }` in `epochShares` without revealing $a_0$. |

### Cross-Epoch Isolation Invariant

Because buckets are keyed by `${effectiveEpoch}::${nullifier}`, submitting a share with the same nullifier and secret in a **different** epoch (`e-100` vs. `e-101`, or `prevDay` vs. `nextDay`) maps to a distinct bucket and is **accepted** without triggering slashing.

---

## 4. Zero-Downtime Epoch Key Rotation & Exact UTC Midnight Boundary

To prevent race conditions when clients sign shares just before `00:00:00.000 UTC` and deliver them milliseconds after UTC midnight, `resolveUtcEpoch(timestampMs, skewWindowMs)` computes:

```text
midnightMs         = floor(timestampMs / 86_400_000) * 86_400_000
msSinceUtcMidnight = timestampMs - midnightMs
dayKey             = getUtcDayKey(timestampMs)        // "YYYY-MM-DD"
previousDayKey     = getUtcDayKey(midnightMs - 1)     // Prior UTC "YYYY-MM-DD"
inRolloverGrace    = msSinceUtcMidnight <= skewWindowMs
```

### Boundary Behavior at `00:00:00.000Z` and During `[0, midnightRolloverSkewMs]`

1. **Exact UTC Midnight (`msSinceUtcMidnight === 0`)**:
   - `inRolloverGrace` evaluates to `true` (because `0 <= safeSkew` for any `safeSkew >= 0`).
   - `dayKey` is the new UTC date (e.g. `2026-11-26`), while `previousDayKey` is the just-ended UTC date (`2026-11-25`).
2. **In-Flight Previous-Epoch Shares Inside the Grace Window (`0 <= msSinceUtcMidnight <= midnightRolloverSkewMs`)**:
   - `resolveEffectiveEpoch(epoch, timestampMs)` checks `if (utcInfo.inRolloverGrace && String(epoch) === utcInfo.previousDayKey)` and keeps the share bound to `previousDayKey`.
   - Two distinct shares tagged with `previousDayKey` arriving during the grace window (e.g., at `+250ms` and `+500ms`) still land in the same `previousDayKey::nullifier` bucket and correctly trigger double-spend slashing.
3. **New-Epoch Shares at or After Midnight (`epoch === dayKey`)**:
   - Submissions tagged with the new `dayKey` resolve immediately to `dayKey::nullifier`, enabling zero-downtime key rotation across both epochs during the overlap window without cross-contaminating quota buckets.
4. **After the Grace Window (`msSinceUtcMidnight > midnightRolloverSkewMs`)**:
   - `inRolloverGrace` is `false`; `resolveEffectiveEpoch` returns `epoch` verbatim and the overlap window closes cleanly.

---

## 5. Verification

Unit tests in [`src/tests/features/zkp/rlnSlasherGuard.test.ts`](../../src/tests/features/zkp/rlnSlasherGuard.test.ts) and [`src/__tests__/features/zkp/rlnSlasherGuard.test.ts`](../../src/__tests__/features/zkp/rlnSlasherGuard.test.ts) cover:
- Single valid share acceptance without secret leakage.
- Exact duplicate replay rejection (`duplicate_share`).
- Modular inverse secret recovery on two distinct shares in the same epoch (`slashed`) and cross-epoch isolation.
- UTC midnight rollover overlap window (`midnightRolloverSkewMs: 2_000`) with concurrent `prevDay` slashing and `nextDay` acceptance.
