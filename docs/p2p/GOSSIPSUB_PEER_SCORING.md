# GossipSub Peer Scoring

This guide documents `GossipSubPeerScorer`, the
GossipSub v1.1 style peer scoring and Sybil mitigation engine in the WorkSphere
P2P layer. It covers the score formula, every default weight, decay factor and
threshold, how decay half-lives work, how IP colocation limits Sybil clusters,
tuning for low-bandwidth and high-throughput nodes, and how to extend the
scorer from application code.

Source files:

- [`src/core/p2p/GossipSubPeerScorer.ts`](../../src/core/p2p/GossipSubPeerScorer.ts):
  the scorer described here.
- [`src/__tests__/p2p/GossipSubPeerScorer.test.ts`](../../src/__tests__/p2p/GossipSubPeerScorer.test.ts):
  unit coverage for the formulas in this guide.

> **Accuracy note.** This guide describes what the code does today, which is a
> simplified form of the libp2p GossipSub v1.1 scoring spec. Things readers
> often expect that are **not** in `GossipSubPeerScorer`:
>
> - There is no blacklist threshold. Only a graylist threshold exists.
> - `acceptPXThreshold` is stored in the thresholds object, but no method reads
>   it, so peer exchange is not gated by this class.
> - There is no behaviour penalty (spec P7), no opportunistic graft threshold,
>   and no mesh-delivery activation window.
> - `meshMessageDeliveriesCap` is declared in `TopicScoreParams` but is never
>   applied by `score()` or by the increment methods.
> - `recordDeliveryFailure()` is called by your code. The scorer does not detect
>   failures or prunes on its own.
> - There is no API for registering score inspectors. [Section 7](#7-extending-and-inspecting-the-scorer)
>   shows the supported extension points.

## 1. How the score is used

The scorer is a policy helper. It computes a number per peer and answers
three yes/no questions. Your networking code is responsible for acting on the
answers.

| Method              | Returns `true` when         | Intended use (enforced by the caller)          |
| ------------------- | --------------------------- | ---------------------------------------------- |
| `shouldGossip(id)`  | `score >= gossipThreshold`  | Send or accept gossip with this peer           |
| `shouldPublish(id)` | `score >= publishThreshold` | Include this peer when publishing own messages |
| `isGraylisted(id)`  | `score < graylistThreshold` | Ignore all traffic from this peer              |
| `prunePeer(id)`     | (void)                      | Forget the peer and release its IP slot        |

Terminology used by the issue, the GossipSub spec and this code:

| Spec / issue term             | Code                                          |
| ----------------------------- | --------------------------------------------- |
| P1 Time in Mesh               | `timeInMesh*` params, `meshTimeMs` state      |
| P2 First Message Deliveries   | `firstMessageDeliveries*`                     |
| P3 Mesh Message Deliveries    | `meshMessageDeliveries*` (deficit penalty)    |
| P3b Mesh Failure Penalty      | `meshFailure*`, `meshFailures` state          |
| P4 Invalid Message Deliveries | `invalidMessageDeliveries*`                   |
| P5 Application-specific score | `appSpecificWeight`, `setAppSpecificScore()`  |
| P6 IP colocation factor       | `ipColocationWeight`, `ipColocationThreshold` |
| P7 Behaviour penalty          | not implemented                               |

## 2. Score formula

```text
topicScore(t) = P1 + P2 + P3 + P3b + P4
score(peer)   = clamp( sum over topics t of topicWeight(t) * topicScore(t)
                       + colocation
                       + appSpecificWeight * appSpecificScore,
                       MIN_PEER_SCORE, MAX_PEER_SCORE )
```

`MIN_PEER_SCORE` is `-1000` and `MAX_PEER_SCORE` is `100`. A `NaN` or `-Infinity`
total clamps to `-1000` (fail closed), and `+Infinity` clamps to `100`.

### 2.1 Components

| Counter       | Applies when                                                     | Formula                                                              | Default shape                                                |
| ------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| P1            | peer is in the mesh                                              | `min(floor((meshTimeMs + elapsedMeshMs) / quantumMs) * weight, cap)` | +0.05 per second, capped at +10 (after 200 s)                |
| P2            | always                                                           | `min(firstMessageDeliveries, cap) * weight`                          | +1.0 per delivery, capped at +50                             |
| P3            | peer is in the mesh and `meshMessageDeliveries < threshold`      | `(threshold - meshMessageDeliveries)^2 * weight`                     | `-0.5 * deficit^2`, worst case `-12.5`                       |
| P3b           | always                                                           | `meshFailures * weight`                                              | `-1.0` per failure (linear)                                  |
| P4            | `invalidMessages > 0`                                            | `invalidMessages^2 * weight`                                         | `-10`, `-40`, `-90`, `-160` for 1 to 4                       |
| IP colocation | peer has an IP shared by more than `ipColocationThreshold` peers | `(ipCount - threshold)^2 * ipColocationWeight`                       | `-5 * excess^2`, see [section 5](#5-sybil-attack-mitigation) |
| App-specific  | always                                                           | `appSpecificScore * appSpecificWeight`                               | `1.0 * appSpecificScore`                                     |

Notes:

- The P1 cap applies to the weighted value. The P2 cap applies to the raw count
  before weighting.
- P3 is quadratic in the deficit and applies **immediately** on joining the mesh
  (see the cold-start note in [section 6](#6-tuning-guidelines)).
- P3b is linear and driven only by `recordDeliveryFailure()`.
- P4 and P3b count regardless of whether the peer is currently in the mesh.

### 2.2 How counters are fed

| Method                               | Effect on state                                                    |
| ------------------------------------ | ------------------------------------------------------------------ |
| `joinTopic(peer, topic)`             | `inMesh = true`                                                    |
| `leaveTopic(peer, topic)`            | `inMesh = false`; counters and `meshTimeMs` are kept               |
| `deliverFirstMessage(peer, topic)`   | `firstMessageDeliveries += 1` **and** `meshMessageDeliveries += 1` |
| `deliverMessage(peer, topic)`        | `meshMessageDeliveries += 1`                                       |
| `recordDeliveryFailure(peer, topic)` | `meshFailures += 1`                                                |
| `recordInvalidMessage(peer, topic)`  | `invalidMessages += 1`                                             |
| `setIP(peer, ip)`                    | moves the peer to a new IP bucket                                  |
| `setAppSpecificScore(peer, score)`   | replaces (does not add to) the app-specific score                  |
| `decayScores(stepMs = 1000)`         | decays counters, advances `meshTimeMs` for in-mesh topics          |

All counters are sanitised: `NaN`, negative and non-finite values are coerced to
safe values, and counters are bounded by `Number.MAX_SAFE_INTEGER`.

## 3. Score thresholds

The default thresholds are:

| Threshold           | Default | Behaviour                                             |
| ------------------- | ------: | ----------------------------------------------------- |
| `gossipThreshold`   |     -10 | `shouldGossip()` returns true at or above this score  |
| `publishThreshold`  |     -40 | `shouldPublish()` returns true at or above this score |
| `graylistThreshold` |     -80 | `isGraylisted()` returns true below this score        |
| `acceptPXThreshold` |      10 | Stored, but not evaluated by this scorer              |

Threshold comparisons are inclusive for gossip and publishing, but exclusive
for graylisting. A score of exactly `-80` is not graylisted.

The class does not implement a separate blacklist threshold. The networking
layer must enforce the decisions returned by these methods.

## 4. Counter decay and mesh time

`decayScores()` applies geometric decay to delivery and penalty counters. For a
counter value `C` and decay factor `d`, each decay invocation applies:

```text
newCounter = C * d
```

The half-life, measured in decay invocations, is:

```text
halfLife = ln(0.5) / ln(decayFactor)
```

| Counter                    | Default decay |  Half-life |
| -------------------------- | ------------: | ---------: |
| First message deliveries   |          0.90 | 6.58 ticks |
| Mesh message deliveries    |          0.90 | 6.58 ticks |
| Mesh failures              |          0.85 | 4.27 ticks |
| Invalid message deliveries |          0.80 | 3.11 ticks |

A tick is one call to `decayScores()`. With the default one-second timer, these
values are approximately seconds. If you change the timer interval, the number
of ticks remains the same but the elapsed wall-clock time changes.

### 4.1 Decay step versus decayIntervalMs

The constructor's `decayIntervalMs` controls how frequently the automatic timer
calls `decayScores()`. However, the timer calls `decayScores()` without an
argument, so each invocation uses the default `timeStepMs = 1000`.

This means the mesh-time counter advances by one second per timer callback, not by the configured timer interval. For example:

- `decayIntervalMs: 500` advances mesh time by 1000 ms every 500 ms.
- `decayIntervalMs: 2000` advances mesh time by 1000 ms every 2000 ms.

For custom timing, disable or account for the automatic timer and call
`decayScores(stepMs)` yourself. You can also pass `elapsedMeshMs` to
`score(peerId, elapsedMeshMs)` to include additional elapsed mesh time in that
calculation without updating stored mesh time.

### 4.2 Choosing decay factors

A factor closer to `1` retains counter history longer. A smaller factor removes history faster.

Use finite factors between `0` and `1` for normal decay. The implementation
treats negative or non-finite factors as `1`, preserving the counter. Factors
greater than `1` are accepted and can increase counters rather than decay them.

Validate custom topic parameters before applying them with `setTopicParams()`.

## 5. Sybil attack mitigation

The scorer limits Sybil clusters with these mechanisms:

1. **IP colocation penalty.** `setIP()` registers a peer in an IP bucket. When
   more than `ipColocationThreshold` (default `2`) peers share an IP, every peer
   in that bucket receives `(count - threshold)^2 * ipColocationWeight`.
   The penalty is quadratic, so each extra peer costs more than the last, and it
   applies to every peer in the bucket.
2. **Mesh delivery deficit (P3).** Peers in the mesh that stay silent lose score,
   so spinning up many idle identities is not free.
3. **Invalid message penalty (P4).** Quadratic, with the heaviest default weight.
4. **Clamping and fail-closed maths.** Scores are bounded to `[-1000, 100]`, and a
   `NaN` score becomes `-1000`, so malformed inputs cannot dodge penalties.
5. **Cleanup.** `prunePeer()` removes the peer and shrinks its IP bucket, which
   lifts the penalty from the remaining peers.

### 5.1 Penalty by number of peers on one IP (defaults)

Colocation term only, with `ipColocationThreshold = 2` and `ipColocationWeight = -5`:

| Peers on the IP | Excess | Penalty per peer            | Effect                                           |
| --------------- | ------ | --------------------------- | ------------------------------------------------ |
| 1 to 2          | 0      | `0`                         | none                                             |
| 3               | 1      | `-5`                        | still gossips                                    |
| 4               | 2      | `-20`                       | gossip stops (below `-10`)                       |
| 5               | 3      | `-45`                       | publish stops (below `-40`)                      |
| 6               | 4      | `-80`                       | exactly at the graylist boundary, not graylisted |
| 7               | 5      | `-125`                      | graylisted                                       |
| 20              | 18     | `-1620`, clamped to `-1000` | graylisted, at the floor                         |

Other terms add to these figures. A cluster peer that also sends one invalid
message is `-10` lower again. The unit tests use a heavier weight of `-10`, which
reaches the same stages with fewer peers (3 peers `-10`, 4 peers `-40`).

### 5.2 Limits to be aware of

- Colocation is keyed on the **exact string** passed to `setIP()`. Different
  addresses in one subnet, or one attacker rotating IPv6 addresses, are not grouped.
- Your code must call `setIP()` with an address taken from the transport, not from
  a value the peer claims about itself.
- Honest peers behind carrier-grade NAT or a shared office gateway are penalised
  together. Raise `ipColocationThreshold` for deployments where that is common.
- Sybils that stay under the threshold, or spread over many IPs, are only limited
  by P3 and P4.

## 6. Tuning guidelines

The values below are starting points derived from the formulas in this guide.
They have not been benchmarked against a live mesh, so validate them with your
own traffic.

### 6.1 Two rules of thumb

**Cold-start penalty.** There is no activation window, so a peer that joins the
mesh with zero deliveries immediately scores `-(threshold^2 * |weight|)` from P3.
Keep this at or above `gossipThreshold`, otherwise every new peer is denied
gossip until it delivers something:

```text
meshMessageDeliveriesThreshold^2 * |meshMessageDeliveriesWeight|  <=  |gossipThreshold|
```

The defaults give `5^2 * 0.5 = 12.5`, which is just over `10`. A new mesh peer
starts at `-12.5` and returns to `-8` after its first delivery.

**Steady-state count.** A peer delivering `r` messages per tick settles near
`r / (1 - decay)` deliveries. To avoid a P3 penalty, you need
`r / (1 - decay) >= threshold`. With defaults (`decay 0.9`, threshold `5`), that is
roughly 0.5 messages per second.

### 6.2 Scenario guide

| Scenario                | Parameters to change                                                                                | Direction                                                  | Trade-off                               |
| ----------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------- |
| Low-bandwidth mesh      | `meshMessageDeliveriesThreshold`, `meshMessageDeliveriesWeight`, decay factors                      | Lower threshold and weight, decays toward `0.95` to `0.97` | Slower to expose genuinely bad peers    |
| High-throughput node    | `meshMessageDeliveriesThreshold`, `firstMessageDeliveriesCap` and weight, mesh/first-delivery decay | Higher threshold with a smaller weight, faster decay       | Penalises brief stalls sooner           |
| Shared NAT / datacenter | `ipColocationThreshold`                                                                             | Raise it (for example `5`)                                 | Weaker Sybil resistance per IP          |
| Stricter spam policy    | `invalidMessageDeliveriesWeight`, `graylistThreshold`                                               | More negative weight or higher graylist                    | More false positives from buggy clients |

### 6.3 Low-bandwidth example

Few messages arrive, so expect fewer deliveries per peer, remember problems for
longer, and punish silence lightly:

```ts
import {
  GossipSubPeerScorer,
  DEFAULT_TOPIC_SCORE_PARAMS,
  type TopicScoreParams,
} from "@/core/p2p/GossipSubPeerScorer";

const lowBandwidthTopic: TopicScoreParams = {
  ...DEFAULT_TOPIC_SCORE_PARAMS,
  meshMessageDeliveriesThreshold: 2, // cold start: 2^2 * 0.25 = 1.0
  meshMessageDeliveriesWeight: -0.25,
  firstMessageDeliveriesDecay: 0.97, // half-life about 22.8 ticks
  meshMessageDeliveriesDecay: 0.97, // steady state r / 0.03, so about 1 message per 17 s keeps P3 at 0
  meshFailureDecay: 0.95, // half-life about 13.5 ticks
  invalidMessageDeliveriesDecay: 0.95, // keep invalid-message memory longer
};

const scorer = new GossipSubPeerScorer({
  topics: new Map([["alerts", lowBandwidthTopic]]),
});
```

### 6.4 High-throughput example

Plenty of traffic, so require more deliveries, forget faster, and reward first
deliveries more. Keep the cold-start rule in mind: a threshold of `10` needs a
weight no heavier than `-0.1`.

```ts
const highThroughputTopic: TopicScoreParams = {
  ...DEFAULT_TOPIC_SCORE_PARAMS,
  meshMessageDeliveriesThreshold: 10, // cold start: 10^2 * 0.1 = 10, exactly at gossipThreshold
  meshMessageDeliveriesWeight: -0.1,
  meshMessageDeliveriesDecay: 0.8, // half-life about 3.1 ticks, steady state 5r so r >= 2 per second
  firstMessageDeliveriesDecay: 0.8,
  firstMessageDeliveriesCap: 100,
  firstMessageDeliveriesWeight: 0.5,
};

const scorer = new GossipSubPeerScorer({
  topics: new Map([["feed", highThroughputTopic]]),
  ipColocationThreshold: 5,
});
```

Always call `scorer.dispose()` when the scorer is no longer needed. It clears the
decay timer and all tracked peers.

## 7. Extending and inspecting the scorer

`GossipSubPeerScorer` has no hook for registering a score inspector. Everything
below is built from public methods, so nothing here changes the scorer itself.

### 7.1 Feed an application-specific score

`setAppSpecificScore()` replaces the stored value, and `score()` multiplies it by
`appSpecificWeight` (default `1.0`). Call it whenever your own reputation signal
changes. A `NaN` value makes the peer score `-1000`.

```ts
import { GossipSubPeerScorer } from "@/core/p2p/GossipSubPeerScorer";

const scorer = new GossipSubPeerScorer();

function applyReputation(
  peerId: string,
  verified: boolean,
  strikes: number,
): void {
  const value = (verified ? 5 : 0) - strikes * 2;
  scorer.setAppSpecificScore(peerId, Number.isFinite(value) ? value : 0);
}
```

### 7.2 Attach a read-only score inspector

This helper polls `getAllPeerScores()` and passes a snapshot to your callback.
It returns a function that stops polling.

```ts
import { GossipSubPeerScorer } from "@/core/p2p/GossipSubPeerScorer";

type ScoreInspector = (scores: ReadonlyMap<string, number>) => void;

export function attachScoreInspector(
  scorer: GossipSubPeerScorer,
  inspector: ScoreInspector,
  intervalMs = 5000,
): () => void {
  const timer = setInterval(() => {
    try {
      inspector(scorer.getAllPeerScores());
    } catch (error) {
      console.error("[score-inspector] inspector threw", error);
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

// Example: log peers that crossed the graylist threshold
const detach = attachScoreInspector(scorer, (scores) => {
  for (const [peerId, value] of scores) {
    if (scorer.isGraylisted(peerId)) {
      console.warn(`[scoring] graylisted ${peerId} score=${value.toFixed(1)}`);
    }
  }
});
// later: detach();
```

`getAllPeerScores()` recomputes every peer and topic, so keep the interval
reasonable on large meshes. Wrap callbacks in `try/catch` as above so one faulty
inspector cannot stop the timer.

### 7.3 Inspect one peer's counters

`getPeerStats()` returns the live peer record with a shallow `Readonly` TypeScript
type. Its nested `Map` and runtime object are not deeply immutable. Treat the
returned data as read-only and create a snapshot before exposing it externally.

```ts
import type { GossipSubPeerScorer } from "@/core/p2p/GossipSubPeerScorer";

export function describePeer(
  scorer: GossipSubPeerScorer,
  peerId: string,
): string {
  const stats = scorer.getPeerStats(peerId);
  if (!stats) return `${peerId}: unknown`;
  const topics = Array.from(stats.topics.entries()).map(
    ([topic, s]) =>
      `${topic}{mesh=${s.inMesh} first=${s.firstMessageDeliveries.toFixed(2)} ` +
      `deliveries=${s.meshMessageDeliveries.toFixed(2)} failures=${s.meshFailures.toFixed(2)} ` +
      `invalid=${s.invalidMessages.toFixed(2)}}`,
  );
  return `${peerId}: score=${scorer.score(peerId).toFixed(2)} ip=${stats.ip ?? "n/a"} ${topics.join(" ")}`;
}
```

### 7.4 Retune a topic at runtime

`setTopicParams(topic, partial)` merges into the topic's current params. Existing
counters are kept, and the next `score()` call uses the new values.

```ts
scorer.setTopicParams("alerts", { invalidMessageDeliveriesWeight: -20 });
```

## 8. Troubleshooting

| Symptom                                    | Likely cause                                                      | What to check                                                           |
| ------------------------------------------ | ----------------------------------------------------------------- | ----------------------------------------------------------------------- |
| New mesh peer is immediately denied gossip | P3 cold-start penalty below `gossipThreshold`                     | Cold-start rule in [section 6.1](#61-two-rules-of-thumb)                |
| P1 never grows                             | Timer disabled and `elapsedMeshMs` not passed                     | `decayIntervalMs`, [section 4.1](#41-decay-step-versus-decayintervalms) |
| Mesh time grows slower than wall clock     | Custom `decayIntervalMs` with the timer's fixed 1000 ms step      | Drive `decayScores(stepMs)` yourself                                    |
| `acceptPXThreshold` has no effect          | The class never evaluates it                                      | Gate peer exchange in your own code                                     |
| `meshMessageDeliveriesCap` has no effect   | Declared but not applied                                          | Cap deliveries before calling `deliverMessage()` if needed              |
| Honest peers penalised together            | Shared IP above `ipColocationThreshold`                           | Raise the threshold                                                     |
| Peer stuck at `-1000`                      | Clamp reached, or a `NaN` app-specific score                      | `getPeerStats(id)`; validate input to `setAppSpecificScore()`           |
| Penalties never wear off                   | Decay not running, or an invalid decay factor preserving counters | Timer, `decayScores()` calls, decay values in range `0` to `1`          |

## 9. References

- [GossipSub v1.1 specification](https://github.com/libp2p/specs/blob/master/pubsub/gossipsub/gossipsub-v1.1.md)
- Vyzovitis et al., "GossipSub: Attack-Resilient Message Propagation in the
  Filecoin and ETH2.0 Networks" (2020)
- [`GossipSubPeerScorer.ts`](../../src/core/p2p/GossipSubPeerScorer.ts) and its
  [unit tests](../../src/__tests__/p2p/GossipSubPeerScorer.test.ts)
