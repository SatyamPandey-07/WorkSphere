# WebRTC TURN Relay & Bandwidth Throttling Troubleshooting Guide

This guide provides developers and systems engineers with actionable diagnostic runbooks, metric walkthroughs, and remediation steps for identifying and resolving WebRTC TURN relay bandwidth throttling, SCTP buffer bloat, and mobile uplink degradation in WorkSphere.

---

## 1. Overview of Dynamic Bandwidth Throttling

In WorkSphere's full-mesh WebRTC architecture, clients establish bidirectional `RTCPeerConnection` channels with every peer in a shared room. When network firewalls or Carrier-Grade NAT (CGNAT) block direct STUN hole-punching, connections fall back to a Traversal Using Relays around NAT (TURN) relay server.

### Why Throttling Is Triggered

Relayed connections share server relay allocations and transit asymmetric mobile or public Wi-Fi uplinks. If a client broadcasts high-frequency canvas coordinates or cursor telemetry unconstrained:

1. **SCTP Buffer Bloat**: Outbound packets accumulate in `RTCDataChannel.bufferedAmount`.
2. **Relay Congestion**: Server bandwidth quotas trigger upstream packet drops and round-trip time (RTT) spikes (>500ms).
3. **Adaptive Clamping**: WorkSphere's `DataChannelRateLimiter` engages, capping transmission to 48 kbps (6,000 bytes/sec) and shedding lower-priority ephemeral messages until the channel drains.

```
+-------------------------------------------------------------------------------+
|                       Dynamic Bandwidth Throttling Logic                      |
|                                                                               |
|   Direct P2P Mesh (host / srflx)          TURN Relay Active (relay)           |
|   ┌────────────────────────────┐          ┌────────────────────────────┐      |
|   │ Full Bandwidth (~1-10 Mbps)│          │ Clamped to 48 kbps         │      |
|   │ Burst: Unbounded           │          │ Burst: 12,000 bytes max    │      |
|   │ Watermark: Normal (64 KB)  │          │ Watermark: 6,000 bytes     │      |
|   └────────────────────────────┘          └────────────────────────────┘      |
|                 ▲                                       │                     |
|                 │         ICE State Switch              │                     |
|                 └───────────────────────────────────────┘                     |
+-------------------------------------------------------------------------------+
```

---

## 2. Identifying Active Transport: Direct P2P vs. TURN Relay

Before debugging throughput degradation, determine whether the degraded peer connection is using direct P2P or a relayed TURN candidate pair.

### Programmatic Inspection via `getStats()`

You can query the active candidate pair directly from the browser console on any active `RTCPeerConnection`:

```javascript
async function inspectActiveCandidatePair(pc) {
  const stats = await pc.getStats();
  let activePair = null;

  stats.forEach((report) => {
    if (report.type === "transport" && report.selectedCandidatePairId) {
      activePair = stats.get(report.selectedCandidatePairId);
    }
  });

  if (!activePair) {
    stats.forEach((report) => {
      if (
        report.type === "candidate-pair" &&
        (report.selected || report.nominated)
      ) {
        activePair = report;
      }
    });
  }

  if (activePair) {
    const local = stats.get(activePair.localCandidateId);
    const remote = stats.get(activePair.remoteCandidateId);

    console.log(`[ICE Status] State: ${activePair.state}`);
    console.log(
      `[Local Candidate] Type: ${local.candidateType} (${local.protocol}://${local.address}:${local.port})`,
    );
    console.log(
      `[Remote Candidate] Type: ${remote.candidateType} (${remote.protocol}://${remote.address}:${remote.port})`,
    );
    console.log(
      `[Metrics] Current RTT: ${activePair.currentRoundTripTime * 1000} ms | Available Outgoing Bitrate: ${activePair.availableOutgoingBitrate}`,
    );

    const isRelayed =
      local.candidateType === "relay" || remote.candidateType === "relay";
    console.warn(`[WorkSphere Engine] TURN Relay Mode Active: ${isRelayed}`);
  }
}
```

### Candidate Type Classification

- **`host`**: Direct local network interface (LAN/Wi-Fi). Unthrottled.
- **`srflx` (Server Reflexive)**: Public NAT IP resolved via STUN. Direct P2P hole-punched. Unthrottled.
- **`prflx` (Peer Reflexive)**: Discovered dynamically during STUN check. Unthrottled.
- **`relay`**: Relayed through TURN server. **Enforces dynamic bandwidth throttle**.

---

## 3. Browser DevTools Diagnostic Walkthrough

### A. Google Chrome: `chrome://webrtc-internals`

1. Open a new tab and navigate to `chrome://webrtc-internals`.
2. Select the `RTCPeerConnection` entry corresponding to the collaborative session.
3. Locate the active **`RTCIceCandidatePair`** table:
   - Verify `nominated` is `true` and `state` is `succeeded`.
   - Inspect `localCandidateType` and `remoteCandidateType`. If either displays `relay`, dynamic throttling is intentionally active.
4. Inspect the **`data-channel`** section:
   - Check `messagesSent` vs. `messagesReceived`.
   - Monitor `bytesSent` slope. If flatlining while user interacts with whiteboard, `RTCDataChannel.bufferedAmount` is saturated.
5. Review the **`bwe` (Bandwidth Estimation) graphs**:
   - `googAvailableSendBandwidth`: Displays the estimated uplink capacity.
   - `googActualEncBitrate`: Displays current active throughput.

### B. Mozilla Firefox: `about:webrtc`

1. Open `about:webrtc` in a dedicated tab.
2. Select the active peer connection under **PeerConnection ID**.
3. Expand **Local Candidates** and **Remote Candidates**:
   - Identify the selected candidate pair indicated by the blue highlight.
4. Review **Trickle ICE logs**:
   - Verify whether STUN binding requests received 401 Unauthorized or timed out before falling back to `typ relay`.
5. Check **Data Channel Statistics**:
   - Inspect send/receive packet drop counts and round-trip delays.

---

## 4. Throttling Parameters & Configuration Reference

WorkSphere's client-side rate limiters (`src/lib/realtime/webrtc/meshConnection.ts` and `src/hooks/useMeshDataChannels.ts`) use the following constants:

| Configuration Parameter              |   Default Value    | Description                                                 | Impact of Modification                                                           |
| :----------------------------------- | :----------------: | :---------------------------------------------------------- | :------------------------------------------------------------------------------- |
| `RELAY_BITRATE_CEILING_BPS`          | `48,000` (48 kbps) | Maximum steady-state byte rate allowed through TURN relay.  | Increasing raises relay server bandwidth costs; decreasing reduces congestion.   |
| `RELAY_BURST_CAPACITY_BYTES`         |  `12,000` (12 KB)  | Token bucket maximum capacity permitting transient spikes.  | Accommodates short whiteboard vector bursts before throttling.                   |
| `RELAY_BUFFERED_LOW_THRESHOLD_BYTES` |   `6,000` (6 KB)   | Low watermark threshold emitting `bufferedamountlow` event. | Lower values trigger backpressure earlier; higher values increase latency.       |
| `HEARTBEAT_INTERVAL_MS`              |    `5,000` (5s)    | Periodic ping verifying channel responsiveness.             | Shorter intervals detect drops faster; longer intervals conserve mobile battery. |
| `HEARTBEAT_TIMEOUT_MS`               |   `15,000` (15s)   | Maximum unanswered interval before triggering ICE restart.  | Prevents premature reconnections on temporary mobile radio state transitions.    |
| `ICE_RESTART_BACKOFF_BASE_MS`        |    `1,000` (1s)    | Initial exponential backoff delay for ICE restarts.         | Bounded by max backoff (30s) to prevent hammering signaling servers.             |

---

## 5. Common Symptoms & Step-by-Step Remediation

### Symptom 1: Whiteboard Canvas Laggy While Audio Remains Clear

- **Root Cause**: Audio and data channels share transport capacity, but audio uses UDP RTP prioritization while data channels use SCTP reliable retransmission. When relayed bandwidth caps are hit, data packets queue behind unacknowledged packets.
- **Remediation**:
  1. Confirm `isRelayed` is true via `inspectActiveCandidatePair()`.
  2. Verify that high-frequency ephemeral updates (cursor coordinates) use `coalesceKey: "cursor"` so stale coordinates are replaced in-flight rather than accumulating in the queue.
  3. Ensure whiteboard path draws send simplified Bézier paths rather than raw mousemove streams.

### Symptom 2: Frequent `relay_reconnecting` State Transitions

- **Root Cause**: The TURN relay TCP/TLS allocation timed out due to cellular IP handover or asymmetric carrier firewall NAT closing idle TCP ports after 30 seconds.
- **Remediation**:
  1. Ensure `meshConnection.ts` keepalive heartbeats are active (`sendHeartbeat()`).
  2. Verify TURN server supports UDP transport (`turn:relay.worksphere.com:3478?transport=udp`) alongside fallback `turn:...:443?transport=tcp`.
  3. Check signaling logs for ICE restart offers (`createOffer({ iceRestart: true })`).

### Symptom 3: Complete Connection Drop on Corporate VPN or Hotel Portal

- **Root Cause**: Enterprise firewall deep packet inspection (DPI) blocks non-TLS UDP traffic on non-standard ports.
- **Remediation**:
  1. Verify TURN server is listening on port `443` over TLS (`turns:relay.worksphere.com:443?transport=tcp`).
  2. Ensure `relayIceServers` configuration includes valid short-lived credentials generated via HMAC-SHA1 REST API.
