# Distributed Bloom Limiter

Specification and operating guide for `DistributedBloomLimiter`, the counting Bloom filter rate limiter used as a fallback when the primary (Redis backed) limiter is unavailable.

* Source: [`src/lib/edge/DistributedBloomLimiter.ts`](../../src/lib/edge/DistributedBloomLimiter.ts)
* Tests: [`src/__tests__/edge/bloomLimiter.test.ts`](../../src/__tests__/edge/bloomLimiter.test.ts)
* Related: [Rate limiting](../RATE_LIMITING.md), [Redis cache and rate limit](../REDIS_CACHE_AND_RATELIMIT.md), [Edge geo routing](../EDGE_GEO_ROUTING.md)

Every number in this document was produced by running the real class (Node 22, see [Reproducing the numbers](#11-reproducing-the-numbers)), not derived by hand alone. Where the behavior differs from what a code comment or a textbook would suggest, that is called out explicitly.

> **Status:** at the time of writing the limiter is exercised only by its unit tests. It is not yet registered in `src/lib/middleware`. [Section 9](#9-edge-middleware-integration) shows how it fits into the existing middleware chain.

## Contents

1. [Purpose](#1-purpose)
2. [Data structure](#2-data-structure)
3. [Hash derivation](#3-hash-derivation)
4. [Request path](#4-request-path)
5. [Sliding window decay](#5-sliding-window-decay)
6. [False positives and sizing](#6-false-positives-and-sizing)
7. [Gossip synchronization](#7-gossip-synchronization)
8. [Configuration profiles](#8-configuration-profiles)
9. [Edge middleware integration](#9-edge-middleware-integration)
10. [Known limitations and tuning checklist](#10-known-limitations-and-tuning-checklist)
11. [Reproducing the numbers](#11-reproducing-the-numbers)

---

## 1. Purpose

The primary limiters keep their state in Redis. During a Redis outage or network partition an edge instance has nothing to count against, and failing open would remove all protection. The Bloom limiter gives each edge instance a small, fixed memory, in-process counter set that:

* needs no network call on the request path (`k` array reads and writes per request, plus one pass over the 64 KiB per elapsed decay window, at most three passes, see [section 5](#5-sliding-window-decay)),
* never grows with the number of clients (fixed 64 KiB by default),
* can be shared between instances through a key-value store ("gossip") on a best effort basis,
* forgets old traffic through a sliding window decay.

The price is approximation: counters are shared between clients through hash collisions, so a client can occasionally be limited because of other clients' traffic. [Section 6](#6-false-positives-and-sizing) quantifies this.

---

## 2. Data structure

The state is a single `Uint8Array` of `sizeBytes` bytes (default `65536`, 64 KiB). Each byte holds two 4-bit counters:

```
byte i:  [ high nibble = counter 2i+1 | low nibble = counter 2i ]
```

| Quantity | Formula | Default |
| --- | --- | --- |
| Bytes | `sizeBytes` | 65,536 |
| Counters `m` | `2 * sizeBytes` | 131,072 |
| Hash functions `k` | `hashFunctionsCount` | 4 |
| Counter range | 0 to 15 (4 bits) | 0 to 15 |

Counter `idx` is read and written as:

```ts
byteIndex = Math.floor(idx / 2)
isHigh    = idx % 2 === 1
value     = isHigh ? (byte >> 4) & 0x0f : byte & 0x0f
```

Increments **saturate at 15**: a counter at 15 stays at 15. Two consequences:

* `thresholdCount` greater than 15 could never trigger, so the constructor clamps it to 15. Before this was enforced, `thresholdCount: 20` silently disabled limiting: a single client sent 100 requests and none were limited. Keep `1 <= thresholdCount <= 15`.
* Heavy clients stop contributing to collisions beyond 15 per counter, which bounds the damage a single abusive client can do to its neighbours.

> The header comment in the source mentions "524,288 4-bit counters" for 64 KB. 64 KiB is 65,536 bytes, which is 131,072 counters. 524,288 counters would need `sizeBytes: 262144` (256 KiB). All formulas here use `m = 2 * sizeBytes`.

`sizeBytes` must be a finite number of at least 1 (a fractional value is rounded down); anything else falls back to the default of 65,536. `exportState()` returns a copy of the bytes and `importState(data)` loads them when `data.length === sizeBytes` (other lengths are ignored silently).

---

## 3. Hash derivation

All `k` indexes for a client key (an IP address, a user id, any string) come from one hash function evaluated with `k` different seeds:

```
seed_i = i * 0x9e3779b9                 for i = 0 .. k-1   (golden ratio constant)

hash(key, seed):
    h = seed XOR key.length             // coerced to a signed 32-bit integer
    for each UTF-16 code unit c of key:
        h = imul(h XOR c, 0x5bd1e995)   // 32-bit multiply, MurmurHash2 multiplier
        h = h XOR (h >>> 13)
    return abs(h % m)                   // m = 2 * sizeBytes
```

Notes:

* It is a Murmur-style multiply and xorshift loop. It is **not** a full MurmurHash3 (no block mixing, no final avalanche), despite the comment in the source.
* `h % m` keeps the sign of `h` in JavaScript, hence the `abs`.
* The `k` functions are the same function with different seeds, not independent families. This is the usual shortcut and is adequate here: after inserting `n` distinct keys the measured fraction of non-zero counters matches the ideal `1 - e^(-kn/m)`:

| Distinct keys `n` | Non-zero counters (measured) | Ideal |
| --- | --- | --- |
| 1,000 | 3.00% | 3.01% |
| 10,000 | 26.34% | 26.30% |
| 50,000 | 78.17% | 78.26% |
| 100,000 | 95.33% | 95.27% |

* Keys are hashed as given. Normalize before calling (for example lower-case IPv6 and strip ports) or one client will occupy several counter sets.

---

## 4. Request path

`checkAndIncrement(key, now = Date.now())` does the following, in order:

1. **Clock guard.** A finite `now` is clamped to the range 0 to `Number.MAX_SAFE_INTEGER`. `NaN` and `+/-Infinity` carry no time information, so they are replaced by the last decay time: no decay happens and the state is left alone. Then, if `lastDecayTime` is `0` or in the future (clock moved backwards), it is set to `now`.
2. **Decay** (only when `windowDurationMs > 0`), see [section 5](#5-sliding-window-decay).
3. **Read.** Compute the `k` indexes and `maxCount`, the **largest** of the `k` counters.
4. **Blocked.** If `maxCount >= thresholdCount`, return `{ limited: true, maxCount }`. Counters are **not** incremented.
5. **Count.** Otherwise increment all `k` counters (saturating at 15), let `newMax` be the largest result, and return `{ limited: newMax >= thresholdCount, maxCount: newMax }`.

Three properties follow directly:

* **The request that reaches the threshold is itself reported limited.** With threshold `T` a client gets `T - 1` accepted requests, then the `T`-th is rejected (and counted). The unit test confirms this: threshold 5, the fifth request is limited.
* **Blocked requests are free.** Step 4 does not increment, so hammering a blocked endpoint does not extend the penalty. Recovery comes only from decay (or `reset()`).
* **The decision uses the maximum counter**, not the minimum. This is the opposite of a count-min sketch (which takes the minimum because collisions only inflate counters). It makes the limiter conservative, and it dominates the false positive analysis in [section 6](#6-false-positives-and-sizing).

---

## 5. Sliding window decay

Decay is enabled by `windowDurationMs > 0`. It is evaluated lazily, only when a request arrives, using the `now` passed to `checkAndIncrement`.

### 5.1 Definition

Let `W = windowDurationMs`, `f = decayFactor` (default `0.5`), `tau = lastDecayTime`, and a request arrive at time `t > tau`:

```
n = floor((t - tau) / W)          // whole windows elapsed

n = 0       : no change
1 <= n <= 3 : repeat n times:  c <- floor(f * c)   for every counter c
              tau <- tau + n * W                    // the remainder (t - tau) mod W carries over
n >= 4      : every counter <- 0
              tau <- t                              // the remainder is discarded
```

Properties:

* **Discrete, not continuous.** Counters are untouched inside a window and drop in steps when a window boundary has passed. Within a window, a counter that has not yet decayed is read at full value.
* **Iterated floor.** After `n` steps a counter is `c_n = floor(f * c_(n-1))`, which is lower than `floor(f^n * c_0)` by up to one unit per step. Counters at 1 decay straight to 0 for any `f < 1`.
* **Fractional remainder carries over** for `n <= 3`, so the schedule does not drift. Example (`W = 10 s`, `f = 0.5`): eight requests at `t0` give 8. At `t0 + 10 s` one decay step runs (8 becomes 4, then the request makes 5). At `t0 + 25 s` one more step runs and 5 s are carried toward the next boundary.
* **Real valued analogue.** If you want to reason in continuous time, a counter behaves like `c * f^(elapsed / W)`, with half life `t_half = W * ln(0.5) / ln(f)`. For `f = 0.5`, `t_half = W`. The implementation approximates this with the steps above.

### 5.2 Decay trajectories

Counter starting at the saturation value 15, after each successive `decayCounters(f)` call:

| `f` | Steps 0 to 8 |
| --- | --- |
| 0.5 | 15, 7, 3, 1, 0, 0, 0, 0, 0 |
| 0.7 | 15, 10, 7, 4, 2, 1, 0, 0, 0 |
| 0.9 | 15, 13, 11, 9, 8, 7, 6, 5, 4 |

### 5.3 The four window shortcut

When `n >= 4` the limiter zeroes everything instead of decaying four or more times. For `f <= 0.5` this is exact, because 15 reaches 0 after four steps (see the first row above). For larger `f` it is more aggressive than the formula: with `f = 0.9`, four real steps from 15 would leave 8, but a client that is silent for four windows comes back to 0. Treat the shortcut as "idle for four windows means forgotten". It only applies when a single request observes a gap of four or more windows; a busy client decays one window at a time.

### 5.4 Burst and sustained allowance

Take one client alone in the filter (no collisions) that sends requests continuously. Its counters sit at `T` when it is blocked, and every window boundary lowers them to `floor(f * T)`. Therefore:

```
burst allowance  (first window, from zero):   B = T - 1
sustained allowance (every later window):     S = max(0, T - 1 - floor(f * T))
```

Measured with the real class (`W = 10 s`, one client hammering the limiter):

| `T` | `f` | Accepted per window (windows 1 to 8) | `B` | `S` |
| --- | --- | --- | --- | --- |
| 10 | 0.5 | 9, 4, 4, 4, 4, 4, 4, 4 | 9 | 4 |
| 5 | 0.5 | 4, 2, 2, 2, 2, 2, 2, 2 | 4 | 2 |
| 15 | 0.5 | 14, 7, 7, 7, 7, 7, 7, 7 | 14 | 7 |
| 10 | 0.25 | 9, 7, 7, 7, 7, 7, 7, 7 | 9 | 7 |
| 10 | 0.75 | 9, 2, 2, 2, 2, 2, 2, 2 | 9 | 2 |
| 15 | 0.9 | 14, 1, 1, 1, 1, 1, 1, 1 | 14 | 1 |
| 4 | 0.5 | 3, 1, 1, 1, 1, 1, 1, 1 | 3 | 1 |

**Choosing `f` so the allowance is not zero.** If `floor(f * T) >= T - 1` then `S = 0`: after each decay the very next request pushes the counter back to `T` and is rejected, so a client that keeps sending is never served again until it pauses. `T = 10` with `f = 0.9` or `f = 0.95` behaves this way (measured: 9, 0, 0, 0, 0, 0 accepted per window).

**Inverting the formula.** To get a burst `B` and a sustained rate `S` per window:

```
T = B + 1
floor(f * T) = T - 1 - S      ->   f in [ (T-1-S) / T , (T-S) / T )
```

Pick `f` inside that interval (its midpoint is the most forgiving). Example: `B = 9`, `S = 4` gives `T = 10` and `f` in `[0.5, 0.6)`, so `0.5` works.

### 5.5 Valid parameter ranges

The constructor normalizes its options so a bad value cannot corrupt counters or silently disable limiting:

| Parameter | Valid | Behavior outside |
| --- | --- | --- |
| `thresholdCount` | 1 to 15 | Above 15 is clamped to 15 (a counter cannot go higher). A fractional value is rounded up. Below 1, `NaN` or `Infinity` fall back to the default of 10. |
| `decayFactor` | greater than 0 and at most 1 | `NaN` falls back to 0.5. Above 1 (including `Infinity`) is clamped to 1, which means no decay: a larger factor would overflow the 4-bit nibble into its neighbour. `0` or less keeps its meaning of resetting all counters on every decay. |
| `windowDurationMs` | positive number, or `0` to disable | `0`, negative, `NaN` or `Infinity` disable automatic decay. Counters then fall only through `decayCounters()` or `reset()`. |
| `hashFunctionsCount` | integer of at least 1 | A fractional value is rounded down. Below 1, `NaN` or `Infinity` fall back to the default of 4 (a count of 0 or less would have made the limiter never limit). |
| `sizeBytes` | integer of at least 1 | A fractional value is rounded down. Anything else falls back to 65,536 (a negative value used to throw `RangeError`). |

`decayCounters(factor)` applies the same rules to the factor it receives: `NaN` uses the configured factor, a factor above 1 does nothing, `0` or less resets. Before this normalization existed, `decayCounters(1.5)` turned a counter of 15 into 6 (the scaled value overflowed into the neighbouring counter) and `decayCounters(NaN)` wiped the whole filter.

Counters cannot exceed 15 under any load: increments saturate, requests that are already limited do not increment, and a long stall (for example a blocked event loop) is handled by the four window reset in [section 5.3](#53-the-four-window-shortcut).

### 5.6 Manual control

* `decayCounters(factor = decayFactor)` applies one decay step to every counter.
* `reset()` zeroes all counters and sets `lastDecayTime = Date.now()`.

---

## 6. False positives and sizing

### 6.1 Textbook membership probability

For a counting Bloom filter with `m` counters, `k` hash functions and `n` distinct keys, the probability that a key never seen before maps only to non-zero counters is:

```
p = (1 - e^(-k * n / m))^k
```

Optimal `k` for a given `m` and `n`, and the size needed for a target `p`:

```
k_opt = (m / n) * ln 2
m     = -n * ln(p) / (ln 2)^2
```

For the defaults (`m = 131,072`, `k = 4`):

| Distinct keys `n` | `p` | `k_opt` |
| --- | --- | --- |
| 1,000 | 8.2e-7 | 90.9 |
| 10,000 | 4.8e-3 | 9.1 |
| 50,000 | 0.375 | 1.8 |
| 100,000 | 0.824 | 0.9 |

The source comment says the defaults give "less than 1% FPR at 100k items". That does not hold: at 100,000 distinct keys the default size gives 82%. To reach 1% at 100,000 keys you need about 958,506 counters (479,253 bytes, roughly 468 KiB) and `k` of about 7 (6.64).

Here `n` means the keys that are **active within the decay horizon**, not lifetime clients. Decay keeps `n` small.

### 6.2 What actually matters: false limits

A rate limiter does not ask whether a key is in the set; it asks whether any counter reached the threshold. Because the decision uses the **maximum** of the `k` counters ([section 4](#4-request-path)), one inflated counter is enough to limit an innocent client.

Model: `N` clients are active, each sending `c` requests during the decay horizon. Each counter then holds about `c * X` where `X` is Poisson distributed with mean

```
lambda = k * N / m
```

A new client's first request is reported limited when any of its `k` counters is at least `T - 1` (the request itself increments to `T`). With `need = ceil((T - 1) / c)`:

```
q       = P(Poisson(lambda) >= need)
p_false = 1 - (1 - q)^k
```

(An already established block, `maxCount >= T`, uses `need = ceil(T / c)`.)

Prediction against measurement (random IPv4 strings, 40,000 fresh probes, default size, `k = 4`):

| `N` clients | `c` | `T` | `lambda` | Predicted | Measured |
| --- | --- | --- | --- | --- | --- |
| 500 | 4 | 5 | 0.015 | 5.92% | 5.88% |
| 2,000 | 2 | 10 | 0.061 | 0.00% | 0.00% |
| 10,000 | 1 | 10 | 0.305 | 0.00% | 0.00% |
| 20,000 | 3 | 10 | 0.610 | 9.32% | 9.14% |
| 50,000 | 3 | 15 | 1.526 | 7.70% | 7.44% |
| 30,000 | 1 | 5 | 0.916 | 5.58% | 5.68% |

Takeaways:

* The false limit rate is driven by `c` as much as by `N`. Clients that send several requests each make counters jump in steps of `c`, so reaching `T - 1` needs fewer collisions. Low thresholds with chatty clients are the worst case: 500 clients sending 4 requests each at `T = 5` produce about 6% false limits. The existing test `maintains a false positive rate < 1% for distinct IPs` uses a scenario of this shape (500 clients, 4 requests each, `T = 5`): the model predicts about 6% and the test's own IP sequence measures 5.2%, so its 1% assertion does not hold for the default size.
* With a minimum rule the same scenario would give `q^k` (about 5e-8). The maximum rule trades accuracy for being conservative while Redis is down.
* **Larger `k` is worse here**, the opposite of the textbook advice, because more counters per client means more chances for one collision and each request also touches more counters. Analytical example, `N = 30,000`, `c = 1`, `T = 5`: `k = 2` gives 0.25%, `k = 4` gives 5.58%, `k = 7` gives 43.84%. Do not raise `hashFunctionsCount` to "improve accuracy".

### 6.3 Sizing for a target false limit rate

The rate is controlled mainly by `m` (through `lambda`), by `T` and by `c`. Largest `N` that keeps `p_false` at or below 1% with `k = 4`:

| `T` | `c` | 64 KiB (`m = 131,072`) | 256 KiB (`m = 524,288`) |
| --- | --- | --- | --- |
| 5 | 1 | 18,111 | 72,444 |
| 10 | 1 | 92,185 | 368,743 |
| 10 | 3 | 8,638 | 34,555 |
| 15 | 3 | 29,966 | 119,866 |

Quadrupling `sizeBytes` quadruples the supported `N`. A planning helper:

```ts
function falseLimitProbability(
  activeClients: number, // N
  requestsPerClient: number, // c
  threshold: number, // T
  sizeBytes = 65536,
  k = 4,
): number {
  const m = sizeBytes * 2;
  const lambda = (k * activeClients) / m;
  const need = Math.ceil((threshold - 1) / requestsPerClient);

  // q = P(Poisson(lambda) >= need)
  let cdf = 0;
  let term = Math.exp(-lambda);
  for (let i = 0; i < need; i++) {
    cdf += term;
    term *= lambda / (i + 1);
  }
  const q = 1 - cdf;

  return 1 - Math.pow(1 - q, k);
}
```

The Poisson model assumes keys spread evenly. A few very heavy clients inflate their own counters (capped at 15) but do not change `lambda` much. Real traffic behind shared NAT addresses concentrates many users on one key; key on user id where you can.

---

## 7. Gossip synchronization

`syncGossipState()` shares counters between instances through any store implementing `EdgeKVStore`:

```ts
interface EdgeKVStore {
  get(key: string, type?: "arrayBuffer"): Promise<ArrayBuffer | null>;
  put(key: string, value: ArrayBuffer, options?: { expirationTtl?: number }): Promise<void>;
}
```

One cycle:

1. `get(gossipKey, "arrayBuffer")`.
2. Merge the remote bytes into the local counters.
3. `put(gossipKey, localState, { expirationTtl: 10 })` (10 second TTL).

Errors are caught and logged with `console.error`, so a KV outage never breaks the request path. The class does **not** schedule itself. The "5 second gossip cycle" mentioned in the code is a convention for the caller (see [section 9](#9-edge-middleware-integration)).

Behaviors to know:

* **The merge is a maximum per byte, not per counter.** Each byte holds two counters, so the winner is whichever whole byte is larger. Local byte `0x1f` (counters 15 and 1) merged with remote byte `0x32` (counters 2 and 3) gives `0x32`, so the first counter drops from 15 to 2. A per nibble maximum would give `0x3f`. Merging can therefore lose counts as well as add them.
* **The merge takes a maximum, never a sum.** Two instances that each served 5 requests for the same client both end at 5, not 10 (measured). A client whose traffic is spread over `M` instances can obtain up to roughly `M * (T - 1)` accepted requests. Treat `thresholdCount` as a per instance view of the client, not a global quota.
* **Gossip can undo decay.** A maximum merge cannot lower a counter. Measured: instance A decayed a counter from 8 to 4 and counted one request (5), then merged with instance B that had not decayed yet, and A went back to 8. Use windows that are several gossip cycles long (`windowDurationMs` of 10 s or more with a 5 s cycle) so instances decay close together.
* **Read, merge, write is not atomic.** Concurrent publishers overwrite each other and increments can be lost. This is acceptable for a degraded mode fallback.
* **All instances sharing a `gossipKey` must use the same `sizeBytes`.** A remote state of a different size is not merged: the cycle is skipped with a `console.warn`, nothing is written back, and the local counters are untouched. (Before this check, a shorter remote state turned the missing bytes into `NaN` and zeroed most of the local state.)
* **Use one `gossipKey` per limiter profile.** Two profiles sharing a key would merge unrelated counters.
* **Check your KV provider.** The class writes a `sizeBytes` value every cycle with a 10 second TTL. Confirm the provider allows values of that size, that frequency of writes to one key, and a TTL that short.

---

## 8. Configuration profiles

Examples, not defaults. The class defaults are `thresholdCount: 10`, `hashFunctionsCount: 4`, `sizeBytes: 65536`, `windowDurationMs: 0` (no decay), `decayFactor: 0.5`. The burst and sustained columns come from [section 5.4](#54-burst-and-sustained-allowance) and were verified against the class.

| Profile | Key | `thresholdCount` | `decayFactor` | `windowDurationMs` | Burst `B` | Sustained `S` | `gossipKey` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Public API | client IP | 10 | 0.5 | 10,000 | 9 | 4 per 10 s | `bloom:public-api` |
| Sensitive endpoints (sign in, password reset) | client IP | 5 | 0.75 | 30,000 | 4 | 1 per 30 s | `bloom:sensitive` |
| Authenticated WebSocket upgrades | user id | 15 | 0.5 | 10,000 | 14 | 7 per 10 s | `bloom:ws-auth` |

```ts
import {
  DistributedBloomLimiter,
  type BloomLimiterOptions,
  type EdgeKVStore,
} from "@/lib/edge/DistributedBloomLimiter";

export function createBloomProfiles(kvStore?: EdgeKVStore) {
  const base: Pick<BloomLimiterOptions, "kvStore" | "sizeBytes" | "hashFunctionsCount"> = {
    kvStore,
    sizeBytes: 65536,
    hashFunctionsCount: 4,
  };

  return {
    publicApi: new DistributedBloomLimiter({
      ...base,
      thresholdCount: 10,
      decayFactor: 0.5,
      windowDurationMs: 10_000,
      gossipKey: "bloom:public-api",
    }),
    sensitive: new DistributedBloomLimiter({
      ...base,
      thresholdCount: 5,
      decayFactor: 0.75,
      windowDurationMs: 30_000,
      gossipKey: "bloom:sensitive",
    }),
    wsAuthenticated: new DistributedBloomLimiter({
      ...base,
      thresholdCount: 15,
      decayFactor: 0.5,
      windowDurationMs: 10_000,
      gossipKey: "bloom:ws-auth",
    }),
  };
}
```

Guidance:

* **Pick by trust level.** Anonymous traffic keyed by IP gets the lowest `S`. Authenticated traffic keyed by user id can afford a much higher `T` (up to the 15 cap) because the key is stable and not shared behind a NAT.
* **"Dynamic" thresholds** come from two places: the decay (the allowance refills as counters fall) and choosing a different limiter instance per route or tier. A single instance has one threshold; use separate instances, each with its own `gossipKey`, for separate tiers.
* **Pick `f` with the inversion in [section 5.4](#54-burst-and-sustained-allowance)** instead of guessing, and check that `S > 0`.
* **Check capacity** with `falseLimitProbability` from [section 6.3](#63-sizing-for-a-target-false-limit-rate). Three profiles at 64 KiB each is 192 KiB of state per instance.

---

## 9. Edge middleware integration

The repository already composes request handlers with `chainMiddleware` in `src/lib/middleware/chain.ts`, where each handler is a `MiddlewareHandler`. The sketch below adds the Bloom limiter as a second line of defence behind the existing rate limit handler. It is an illustration, not code that exists in the repository: `EDGE_KV` stands for whatever KV binding your platform provides.

```ts
// src/lib/middleware/handlers/bloomFallbackHandler.ts (illustrative)
import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/tokenBucketRateLimit";
import {
  DistributedBloomLimiter,
  type EdgeKVStore,
} from "@/lib/edge/DistributedBloomLimiter";
import type { MiddlewareHandler } from "../types";

declare const EDGE_KV: EdgeKVStore | undefined; // platform binding

const GOSSIP_INTERVAL_MS = 5_000;

const publicApiLimiter = new DistributedBloomLimiter({
  kvStore: EDGE_KV,
  thresholdCount: 10,
  decayFactor: 0.5,
  windowDurationMs: 10_000,
  gossipKey: "bloom:public-api",
});

let lastGossip = 0;

export const bloomFallbackMiddleware: MiddlewareHandler = async (req, ctx, next) => {
  if (req.method === "OPTIONS" || !req.nextUrl.pathname.startsWith("/api")) {
    return next();
  }

  const now = Date.now();
  const identifier = ctx.userId ?? getClientIp(req);
  const { limited } = publicApiLimiter.checkAndIncrement(identifier, now);

  // Share state at most once per gossip interval, off the request path.
  if (now - lastGossip >= GOSSIP_INTERVAL_MS) {
    lastGossip = now;
    const sync = publicApiLimiter.syncGossipState();
    if (typeof ctx.waitUntil === "function") ctx.waitUntil(sync);
    else void sync;
  }

  if (limited) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": "10" } },
    );
  }

  return next();
};
```

Registering it. Use the Bloom handler only while the primary limiter is degraded (for example when the Redis call times out, as `rateLimitMiddleware` already guards with `REDIS_TIMEOUT_MS`). Running both on every request double counts, so gate it on a health flag:

```ts
import { chainMiddleware, rateLimitMiddleware } from "@/lib/middleware";
import { bloomFallbackMiddleware } from "@/lib/middleware/handlers/bloomFallbackHandler";

const withBloomFallback: typeof bloomFallbackMiddleware = (req, ctx, next) =>
  ctx.redisDegraded ? bloomFallbackMiddleware(req, ctx, next) : next();

export const pipeline = chainMiddleware([
  rateLimitMiddleware,
  withBloomFallback,
  // authMiddleware, securityHeadersMiddleware, csrfMiddleware ...
]);
```

(`ctx.redisDegraded` is a placeholder: set it from wherever you detect the outage.)

Operational notes:

* Module level state lives for the lifetime of an edge isolate. Isolates are recycled and scaled out, so any single instance sees only part of the traffic. That is why the gossip exists, and why [section 7](#7-gossip-synchronization) matters.
* Create the limiter once per module, never per request. A new instance starts with an empty filter.
* Pass a stable identifier. Resolve the user first when possible so signed in users are not limited by their NAT neighbours.
* Return `429` with a `Retry-After` of about one window (the first accepted request after a pause needs at most a few decay steps, see [section 5.2](#52-decay-trajectories)).

---

## 10. Known limitations and tuning checklist

Limitations (verified against the code at the time of writing):

1. The decision uses the maximum counter, which raises false limits compared with a count-min rule ([6.2](#62-what-actually-matters-false-limits)).
2. The four window reset shortcut is exact only for `decayFactor <= 0.5` ([5.3](#53-the-four-window-shortcut)).
3. Gossip merges per byte, takes a maximum instead of a sum, and can undo decay ([7](#7-gossip-synchronization)).
4. Default sizing does not give "under 1% at 100k items" ([6.1](#61-textbook-membership-probability)).
5. Out of range options are corrected silently rather than rejected, so check your configuration against [section 5.5](#55-valid-parameter-ranges).

Before deploying a profile:

* [ ] `1 <= thresholdCount <= 15` (other values are corrected, so confirm the value you meant is the value in use)
* [ ] `0 < decayFactor < 1` and `T - 1 - floor(f * T) > 0`
* [ ] `windowDurationMs` is at least two gossip cycles
* [ ] `falseLimitProbability(...)` is acceptable for your expected active clients
* [ ] one distinct `gossipKey` per profile, identical `sizeBytes` on every instance
* [ ] KV provider accepts a `sizeBytes` value written every cycle with a 10 second TTL

---

## 11. Reproducing the numbers

The measurements above can be reproduced with Node 22.6 or newer, which can run TypeScript directly. From the repository root, save this as `bloom-check.mts` and run `node --experimental-strip-types bloom-check.mts`:

```ts
import { DistributedBloomLimiter } from "./src/lib/edge/DistributedBloomLimiter.ts";

// Accepted requests per window for one client that never stops sending.
function accepted(T: number, f: number, windowMs = 10_000, windows = 6) {
  const limiter = new DistributedBloomLimiter({
    sizeBytes: 1024,
    thresholdCount: T,
    decayFactor: f,
    windowDurationMs: windowMs,
  });
  const start = 5_000_000;
  const perWindow: number[] = [];
  for (let w = 0; w < windows; w++) {
    let ok = 0;
    for (let r = 0; r < 100; r++) {
      if (!limiter.checkAndIncrement("client", start + w * windowMs).limited) ok++;
    }
    perWindow.push(ok);
  }
  return perWindow;
}

console.log("T=10 f=0.5", accepted(10, 0.5).join(", ")); // 9, 4, 4, 4, 4, 4
console.log("T=15 f=0.5", accepted(15, 0.5).join(", ")); // 14, 7, 7, 7, 7, 7
console.log("T=10 f=0.9", accepted(10, 0.9).join(", ")); // 9, 0, 0, 0, 0, 0
```
