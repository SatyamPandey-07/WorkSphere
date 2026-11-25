# WebRTC TURN Relay Bandwidth Throttle & Backpressure Specification

## A. Overview

In WorkSphere's peer-to-peer (P2P) architecture, distributed collaboration (such as real-time canvas whiteboards, cursor presence, and spatial audio) is conducted across a full-mesh WebRTC topology. In this topology, every participating peer establishes direct `RTCPeerConnection` and `RTCDataChannel` connections with every other peer in the room.

### The Multi-Peer Mesh Congestion Problem
In an $N$-peer mesh room, each participant maintains $N - 1$ bidirectional peer connections. Sending an update to the room requires transmitting the payload across $N - 1$ outbound channels simultaneously:
$$\text{Outbound Bandwidth Required} = (N - 1) \times R$$
where $R$ is the unthrottled streaming bitrate per channel.

When a nomad connects from a mobile cellular link (e.g. 4G/LTE) or congested public venue Wi-Fi, their uplink is frequently asymmetric, with severely constrained upstream throughput compared to downstream bandwidth. Furthermore, restrictive corporate NATs, symmetric firewalls, or Carrier-Grade NAT (CGNAT) often prevent direct peer-to-peer hole punching via STUN. In these scenarios, Interactive Connectivity Establishment (ICE) must fall back to a Traversal Using Relays around NAT (TURN) relay server.

### Consequences of Unregulated TURN Relay Traffic
1. **Queue Accumulation and SCTP Buffer Bloat:** If a peer transmits high-frequency canvas or cursor updates (e.g., at 30–60 Hz) over a relayed connection, packets accumulate in the browser's underlying SCTP sending buffer (`RTCDataChannel.bufferedAmount`).
2. **Server Bandwidth & Latency Degeneracy:** Relayed traffic flows through intermediate TURN infrastructure. Uncontrolled transmission rapidly saturates relay allocation bandwidth budgets, causing packet loss, round-trip time (RTT) spikes, and potential connection drops.
3. **Head-of-Line Blocking for Real-Time Signals:** Excessive non-critical traffic (such as micro-cursor movements) starves latency-sensitive coordination events, critical whiteboard vector transactions, and audio signaling.

### Purpose of Adaptive Relay Throttling
WorkSphere implements automatic candidate-pair detection, token-bucket rate limiting, update coalescing, and client-side backpressure coordination to bound relayed DataChannel traffic to an aggregate ceiling of 48 kbps (6,000 bytes/sec). When direct P2P connectivity is re-established or active, unconstrained broadband throughput is restored.

---

## B. Architecture and Components

The WebRTC subsystem coordinates transport statistics, DataChannel rate limiters, priority queues, and adaptive application producers.

```
+-----------------------------------------------------------------------------------+
|                              WorkSphere Client Runtime                            |
|                                                                                   |
|  +--------------------------------+       +------------------------------------+  |
|  |     Application Producers      |       |       Candidate Pair Monitor       |  |
|  |  (Canvas, Cursors, Ephemeral)  |       |  (RTCStatsReport / Transport Stats)|  |
|  +--------------------------------+       +------------------------------------+  |
|                  |                                          |                     |
|                  | (Send with priority & coalesceKey)       | (Relay Detection)   |
|                  v                                          v                     |
|  +-----------------------------------------------------------------------------+  |
|  |                         DataChannelRateLimiter                              |  |
|  |                                                                             |  |
|  |  - Token Bucket Refill (6,000 bytes/sec, 12,000 byte burst capacity)       |  |
|  |  - Priority Schedulers: High | Normal | Low                                 |  |
|  |  - Coalescing Engine: Deduplicates cursor/ephemeral keys in queue          |  |
|  |  - Buffer Watermark: RELAY_BUFFERED_LOW_THRESHOLD_BYTES (6,000 bytes)      |  |
|  +-----------------------------------------------------------------------------+  |
|                  |                                                                |
|                  v (Gated Dispatch)                                               |
|  +--------------------------------+       +------------------------------------+  |
|  |         RTCDataChannel         |       |         RTCPeerConnection          |  |
|  |  (bufferedamountlow listener)  |       |   (Local / Remote ICE Candidates)  |  |
|  +--------------------------------+       +------------------------------------+  |
+-----------------------------------------------------------------------------------+
                               |                                 |
                      Direct P2P (srflx/host)            Relayed (relay)
                               |                                 |
                               v                                 v
                        [Remote Peer]                     [TURN Server]
                                                                 |
                                                                 v
                                                          [Remote Peer]
```

### Component Responsibilities

1. **`detectCandidatePairRelay(report: RTCStatsReport)`:**
   - Inspects `transport` and `candidate-pair` statistics to identify active candidate pairs (`state === 'succeeded' || selected === true`).
   - Resolves corresponding `local-candidate` and `remote-candidate` entities.
   - Evaluates candidate types (`host`, `srflx`, `prflx`, `relay`). If either the local or remote candidate type is `relay`, the link is flagged as `status: 'relay'` (`isRelayed: true`).

2. **`DataChannelRateLimiter`:**
   - Enforces the 48 kbps aggregate ceiling across DataChannels on relayed peer connections.
   - Implements a continuous token bucket algorithm with a refill rate of 6,000 bytes/sec and burst capacity of 12,000 bytes.
   - Maintains an in-memory priority queue (`high`, `normal`, `low`) for deferred messages.
   - Interacts with browser-level SCTP backpressure by checking `channel.bufferedAmount` and listening to `bufferedamountlow` events.

3. **Application Producers (Hooks & Components):**
   - **Canvas Whiteboard (`useMeshCanvasWhiteboard`):** Automatically throttles stroke/cursor sampling intervals from 33 ms (~30 fps) in direct mode to 250 ms (4 fps) in relay mode.
   - **Audio Bitrate Control:** Clamps adaptive Opus audio bitrate to 24 kbps in relay mode (`RELAY_OPTIMIZED_AUDIO_BITRATE_BPS`), restoring to 64 kbps (`DIRECT_RESTORED_AUDIO_BITRATE_BPS`) upon direct P2P recovery.
   - **UI Status Indicator (`RoomHeaderConnectionStatus`):** Displays a subtle warning badge (`Relay Mode: Bandwidth Optimized`) informing nomads that relay optimization is active.

### Implementation Status: Confirmed vs. Conceptual

| Capability | Implementation Status | Confirmed Module / Reference |
| :--- | :--- | :--- |
| **Active Relay Candidate Pair Detection** | **Implemented** | `meshConnection.ts` (`detectCandidatePairRelay`) |
| **Token-Bucket DataChannel Limiter** | **Implemented** | `meshConnection.ts` (`DataChannelRateLimiter`) |
| **DataChannel Priority Queuing** | **Implemented** | `meshConnection.ts` (`QueuedDataChannelMessage`, `high`/`normal`/`low`) |
| **In-Queue Message Coalescing** | **Implemented** | `meshConnection.ts` (`coalesceKey`) |
| **SCTP Buffer Threshold Interception** | **Implemented** | `meshConnection.ts` (`bufferedamountlow`, 6,000 byte threshold) |
| **Whiteboard Sampling Adaptation** | **Implemented** | `useMeshCanvasWhiteboard.ts` (33 ms direct $\leftrightarrow$ 250 ms relay) |
| **UI Relay Indicator** | **Implemented** | `RoomHeaderConnectionStatus.tsx` |
| **Explicit DataChannel Feedback Signaling Protocol** | **Conceptual / Future** | *Not implemented.* Rate limiting is currently client-side producer-driven without out-of-band congestion signaling packets. |
| **Dynamic Multi-Step Token Refill Adaptation** | **Conceptual / Future** | *Not implemented.* Token refill is statically fixed at 6,000 B/s for relay mode. |

---

## C. Congestion Feedback Signaling

### Client-Side Backpressure vs. Protocol Signaling
In standard WebRTC DataChannels, congestion feedback operates at the transport layer via SCTP (Stream Control Transmission Protocol, RFC 4960 & RFC 8831). SCTP provides flow control through advertised receiver window sizes (`a_rwnd`) and congestion windows (`cwnd`).

*Critical Specification Distinction:*
- **Confirmed Repository Behavior:** WorkSphere relies on **local client-side backpressure observation** via the W3C WebRTC DataChannel API (`channel.bufferedAmount` and `bufferedAmountLowThreshold`).
- **No Out-of-Band Signaling Protocol:** WorkSphere does not transmit dedicated application-level congestion control messages (such as `THROTTLE_REQUEST`, `CONGESTION_NOTIFICATION`, or credit tokens) over the DataChannel wire. Throttling is executed entirely on the transmitting peer based on local link metrics and buffer states.

### Backpressure Interception Mechanism
When a message is submitted to `DataChannelRateLimiter.send(channel, data, priority, coalesceKey)`:
1. The channel's current buffer occupancy is checked: `channel.bufferedAmount`.
2. If `channel.bufferedAmount <= RELAY_BUFFERED_LOW_THRESHOLD_BYTES` (6,000 bytes) and the token bucket holds sufficient byte tokens, the payload is transmitted immediately via `channel.send()`.
3. If the buffer is congested (`channel.bufferedAmount > 6,000 bytes`) or token balance is exhausted, the payload is enqueued in the internal priority queue.
4. When SCTP ACKs drain the underlying kernel buffer below `bufferedAmountLowThreshold`, the browser fires the `bufferedamountlow` event, which invokes `processQueue()` to resume dispatch.

---

## D. Token-Bucket Rate Limiting

The rate-limiting subsystem regulates relayed transmissions using a continuous token-bucket model.

### Mathematical Model
Let $T(t)$ be the token balance in bytes at time $t$:
$$T(t) = \min\left(C_{\text{burst}}, T(t_{\text{prev}}) + R \times (t - t_{\text{prev}})\right)$$
where:
- $R = 6{,}000\text{ bytes/sec}$ (`RELAY_BANDWIDTH_BUDGET_BYTES_PER_SEC` $\equiv 48\text{ kbps}$)
- $C_{\text{burst}} = 12{,}000\text{ bytes}$ (`RELAY_BURST_CAPACITY_BYTES` $\equiv 2\text{ seconds of budget}$)
- $t - t_{\text{prev}}$ is the elapsed wall-clock time in seconds since the last token replenishment.

### Parameters and Constants

| Parameter Constant | Value | Description |
| :--- | :--- | :--- |
| `RELAY_BANDWIDTH_BUDGET_BPS` | `48,000` | Target throughput in bits per second (48 kbps). |
| `RELAY_BANDWIDTH_BUDGET_BYTES_PER_SEC` | `6,000` | Token refill rate ($48{,}000 / 8$). |
| `RELAY_BURST_CAPACITY_BYTES` | `12,000` | Maximum token bucket depth (2.0-second burst allowance). |
| `RELAY_BUFFERED_LOW_THRESHOLD_BYTES` | `6,000` | Threshold set on `channel.bufferedAmountLowThreshold` (1.0-second buffer headroom). |
| `maxQueueBytes` | `60,000` (default) | Maximum memory allocated to the rate limiter queue (~10 seconds of traffic). |
| `maxQueueMessages` | `500` (default) | Maximum discrete queued packet count before eviction. |

### Message Priority and In-Queue Coalescing
1. **Priority Scheduling:** Queued items are sorted and dequeued strictly by priority:
   $$\text{Priority Ordering: } \text{high} \prec \text{normal} \prec \text{low}$$
2. **Coalescing Engine:** If a newly submitted message carries a `coalesceKey` (e.g. `cursor:peer-123`), the queue is scanned. Any previously pending message with the identical key is updated in-place with the latest payload and timestamp, preventing stale positional backlog.
3. **Queue Eviction:** When queue capacity is breached (`queuedBytes + payloadLength > maxQueueBytes` or `queue.length >= maxQueueMessages`), the limiter searches for and drops `low` priority packets first. If no low-priority packets exist, `normal` packets are evicted to protect application stability.

---

## E. Backpressure State Machine

The client adapts between unconstrained direct transmission and throttled relay operation according to network candidate state and buffer pressure.

```
       +-------------------------------------------------------+
       |                                                       |
       |                     DIRECT MODE                       |
       |  - Local/Remote candidates: 'host' or 'srflx'         |
       |  - DataChannel: Unthrottled direct throughput         |
       |  - Canvas sampling: 33 ms (~30 fps)                   |
       |  - Audio target: 64 kbps                              |
       +-------------------------------------------------------+
                |                                     ^
                | ICE renegotiation /                 | ICE restart /
                | Relay candidate selected            | Direct candidate selected
                v                                     |
       +-------------------------------------------------------+
       |                                                       |
       |                     RELAY MODE                        |
       |  - Local or Remote candidate: 'relay'                 |
       |  - Token bucket active (6,000 B/s, 12,000 B burst)   |
       |  - Canvas sampling: 250 ms (4 fps)                    |
       |  - Audio target: 24 kbps                              |
       |  - UI: 'Relay Mode: Bandwidth Optimized'              |
       +-------------------------------------------------------+
            |                                     ^
            | Tokens exhausted OR                 | bufferedamountlow fired
            | bufferedAmount > 6,000 B            | AND Tokens >= message size
            v                                     |
       +-------------------------------------------------------+
       |                                                       |
       |                 RELAY BACKPRESSURED                   |
       |  - Immediate dispatch paused                          |
       |  - Priority FIFO queuing (high/normal/low)            |
       |  - CoalesceKey deduplication active                   |
       |  - Drain timer unref() polling                        |
       +-------------------------------------------------------+
```

### State Transition Summary

| State | Entry Condition | Exit Condition | Actions Enforced |
| :--- | :--- | :--- | :--- |
| **`DIRECT`** | Active candidate pair has both local and remote types in `['host', 'srflx']`. | ICE restarts or candidate pair switches to `relay`. | Full bandwidth; 33 ms canvas updates; 64 kbps audio; no token bucket restriction. |
| **`RELAY`** | Candidate pair inspection yields `localCandidateType === 'relay' \|\| remoteCandidateType === 'relay'`. | Candidate pair reverts to non-relay candidates. | Token bucket active (6,000 B/s); canvas throttled to 250 ms; audio clamped to 24 kbps; UI badge active. |
| **`RELAY_BACKPRESSURED`** | In Relay mode: token balance is insufficient ($T(t) < \text{size}$) OR `bufferedAmount > 6,000` bytes. | Browser fires `bufferedamountlow` event AND token balance refills $\ge \text{next payload size}$. | Transmissions queued in priority queue; cursor updates coalesced; queue eviction if capacity exceeded. |

---

## F. Sequence Diagram

The following Mermaid sequence diagram illustrates peer-to-peer transmission, relay failover detection, token bucket throttling, and buffer-drained queue dispatch:

```mermaid
sequenceDiagram
    autonumber
    participant App as Application Producer (Canvas / Cursor)
    participant Limiter as DataChannelRateLimiter
    participant DC as RTCDataChannel
    participant PC as RTCPeerConnection (Stats)
    participant TURN as TURN Relay Server
    participant Remote as Remote Peer

    Note over App, Remote: Direct P2P Mode (Host / Srflx candidates active)
    App->>DC: send(vectorUpdate) [Unthrottled, ~30 fps]
    DC->>Remote: Direct SCTP Packet Transmission

    Note over PC, TURN: ICE Disconnect -> Relay Fallback
    PC-->>Limiter: detectCandidatePairRelay() -> status: 'relay'
    Note over Limiter: Enable Token Bucket (6,000 B/s) & Set bufferedAmountLowThreshold (6,000 B)

    App->>Limiter: send(cursorMessage, priority: 'low', coalesceKey: 'cursor:A')
    Note over Limiter: Tokens Available (>= payload size) & bufferedAmount <= 6,000 B
    Limiter->>DC: channel.send(cursorMessage)
    DC->>TURN: Relayed Packet (TURN Send Indication)
    TURN->>Remote: Forward DataChannel Payload

    Note over Limiter: Rapid Burst: Token Bucket Depleted (Tokens < next payload)
    App->>Limiter: send(strokeUpdate, priority: 'high')
    Note over Limiter: Tokens Exhausted -> Enqueue in Priority Queue (high)

    App->>Limiter: send(cursorMessage, priority: 'low', coalesceKey: 'cursor:A')
    Note over Limiter: Coalesce Key Match -> Replace previous pending cursor update in queue

    Note over DC, Limiter: SCTP ACKs received; Buffer drains below 6,000 B
    DC-->>Limiter: Event: 'bufferedamountlow'
    Note over Limiter: Wall-clock elapsed -> Refill tokens (6,000 B/s)
    Limiter->>DC: channel.send(strokeUpdate) [Dequeued High Priority]
    DC->>TURN: Relayed Packet
    TURN->>Remote: Forward DataChannel Payload
```

---

## G. Recovery and Broadband Transition

When a peer transitions from a cellular hotspot back to a robust local Wi-Fi or wired network, ICE renegotiation or reflexive candidate discovery can establish a direct P2P link.

### Recovery Sequence
1. **Candidate Pair Switching:** The WebRTC ICE agent selects a direct candidate pair (`srflx` or `host`).
2. **Stats Detection:** The periodic stats sampler calls `detectCandidatePairRelay(stats)`. The detection changes from `status: 'relay'` to `status: 'direct'`.
3. **De-escalation of Application Producers:**
   - The whiteboard sampling interval decreases from 250 ms to 33 ms (`DIRECT_WHITEBOARD_THROTTLE_MS`).
   - Opus audio max bitrate target increases from 24 kbps to 64 kbps (`DIRECT_RESTORED_AUDIO_BITRATE_BPS`).
   - The UI connection badge transitions from `Relay Mode: Bandwidth Optimized` back to standard direct status.
4. **Draining and Bypassing Rate Limiter:** Any remaining queued messages in `DataChannelRateLimiter` are flushed. Subsequent transmissions bypass token-bucket delay and are dispatched directly to the DataChannel.

### Hysteresis and Anti-Flapping
- **Confirmed Behavior:** Detection is driven by `RTCStatsReport` active transport evaluation. The rate limiter and audio controllers maintain stateful hold periods (e.g. `selectTargetAudioBitrateBps` evaluates metrics over a 5-second sliding window `SLIDING_WINDOW_MS = 5_000` to prevent rapid bitrate oscillation).
- **Limitation / Future Improvement:** Candidate pair polling does not currently implement multi-sample debouncing or exponential backoff hysteresis for candidate-pair flapping. If ICE oscillates rapidly between direct and relay candidates, application parameters may switch proportionally.

---

## H. Limitations and Future Considerations

1. **Client-Side vs. Server-Side Enforcement:**
   - The throttling implementation operates entirely within the client application runtime. It does not reconfigure TURN relay server allocations, kernel socket buffers, or TURN server bandwidth policies. If a non-compliant or malicious peer floods the TURN relay, client-side rate limiting on other peers cannot prevent server-side allocation congestion.
2. **Static Token Rate Ceiling:**
   - The relay budget is currently hardcoded to 48 kbps (`RELAY_BANDWIDTH_BUDGET_BYTES_PER_SEC = 6_000`). It does not dynamically probe link capacity using delay-gradient estimation (such as BBR or GCC for DataChannels).
3. **Absence of End-to-End Explicit Congestion Notification (ECN):**
   - The receiving peer has no application-level mechanism to signal receiver buffer pressure back to the sender over the DataChannel. Senders rely exclusively on sender-side buffer inspection (`channel.bufferedAmount`).
4. **Proposed Future Improvements:**
   - Implement an out-of-band `BACKPRESSURE_SIGNAL` packet format across DataChannels for cooperative flow control between asymmetric peers.
   - Introduce dynamic bandwidth discovery based on keepalive RTT trends (`startDataChannelKeepalive` / RTT calculation from Issue #9895).
   - Add candidate-pair switching hysteresis to prevent rate toggling during transient ICE reconnects.
