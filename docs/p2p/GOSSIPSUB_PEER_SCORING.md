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
