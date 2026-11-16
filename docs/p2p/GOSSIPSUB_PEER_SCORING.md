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

The scorer is a pure policy oracle. It computes a number per peer and answers
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
