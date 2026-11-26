# WebRTC ICE Connection Renegotiation Collision Recovery Runbook

This operational runbook provides step-by-step diagnostic workflows, failure triage procedures, protocol explanations, and incident recovery guidance for Interactive Connectivity Establishment (ICE) connection failures, candidate collisions, and simultaneous renegotiation glare in WorkSphere's peer-to-peer (P2P) mesh networking stack.

---

## 1. Purpose and Scope

### 1.1 The Simultaneous-Join Scenario

WorkSphere collaborative spaces allow nomadic workers to share presence, synchronize state via CRDTs, exchange data files, and engage in real-time audio/video calls. In ad-hoc workspace environments—such as coworking lounges, pop-up breakout hubs, or airport terminals—multiple clients frequently connect, disconnect, or switch network interfaces (e.g., transitioning between venue Wi-Fi, mobile 5G tethering, or corporate VPN tunnels) at the same time.

When multiple nomad clients join a collaborative mesh room concurrently, each client discovers its peers through the signaling layer (PartyKit WebSocket) and initiates connection setup. Without strict tie-breaking and collision management, simultaneous `createOffer` dispatches result in **offer glare**: both endpoints transition their signaling states to `have-local-offer`, cannot accept incoming offers without protocol violations, and deadlock or enter rapid disconnect loops. Concurrently, ICE candidate gathering and trickling over asynchronous signaling channels can cause remote candidates to arrive before remote session descriptions are applied, resulting in dropped candidates or connection timeouts.

### 1.2 Impact of Collisions and Glare

- **Connection Deadlock:** Unhandled offer collisions leave `RTCPeerConnection` signaling states mismatched, preventing session negotiation.
- **Candidate Dropping:** ICE candidates arriving before `setRemoteDescription()` is invoked fail to attach if not buffered, leaving peers unable to find valid candidate pairs.
- **Excessive Latency:** Uncoordinated renegotiation retries trigger storm conditions on signaling channels and browser media engines.
- **Transport Starvation:** In strict NAT/firewall environments, failed candidate pairs exhaust STUN discovery without proper relay escalation.

### 1.3 Scope and Target Audience

- **Target Audience:** Maintainers, site reliability engineers (SREs), and network engineers operating and debugging WorkSphere client deployments.
- **Scope:** Covers client-side WebRTC lifecycle, W3C Perfect Negotiation (RFC 8829 §3.5), `chrome://webrtc-internals` inspection, STUN/TURN fallback mechanics, Path MTU constraints, and recovery procedures across WorkSphere's networking modules:
  - DataChannel mesh engine: `src/core/network/WebRTCMesh.ts`
  - Audio/video call mesh hook: `src/hooks/useWebRTCMesh.ts`
  - ICE reconnection managers: `src/core/webrtc/IceReconnectManager.ts` and `src/lib/webrtc/iceReconnectManager.ts`
- **Limitations:** This runbook addresses client-side browser peer connections and signaling interactions. It does not replace root-cause diagnostics for third-party TURN server infrastructure or physical ISP link outages.

---

## 2. Symptoms and Initial Triage

When WebRTC mesh connectivity degrades, clients report intermittent stream drops, frozen state sync, or total failure to connect. Maintainers should compare observed client behavior against the following symptom-to-investigation matrix.

### 2.1 Symptom-to-Investigation Matrix

| Observable Symptom                                                     | Likely Underlying Cause                                                                                     | Initial Investigation Step                                                                                                                   | Primary Source Reference                                                                |
| :--------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| Peer connection stuck in `iceConnectionState: 'checking'`              | Symmetric NAT or firewall dropping UDP; STUN unable to punch holes; no viable candidate pair.               | Open `chrome://webrtc-internals`, locate candidate pairs, check if responses were received from STUN. Verify if checking fallback triggered. | `src/core/webrtc/IceReconnectManager.ts` (`startCheckingFallback`)                      |
| Peer connection remains in `signalingState: 'have-local-offer'`        | Offer glare deadlock or lost answer; remote peer rejected or failed to process offer.                       | Check browser console for `[WebRTCMesh] Failed to negotiate` or `InvalidStateError`. Inspect `chrome://webrtc-internals` signaling history.  | `src/core/network/WebRTCMesh.ts` (`negotiate`, `handleRemoteDescription`)               |
| Uncaught DOMException: `Failed to execute 'addIceCandidate'`           | Remote ICE candidate received before `setRemoteDescription()` was executed, and pending queue was bypassed. | Inspect `peer.pendingCandidates` queueing behavior and console errors for `Failed to add ICE candidate`.                                     | `src/core/network/WebRTCMesh.ts` (`handleRemoteIceCandidate`, `flushPendingCandidates`) |
| Peers connect 1-on-1, but fail when 3+ peers join simultaneously       | Asynchronous offer glare and candidate race condition under burst signaling traffic.                        | Verify polite vs. impolite role assignment and check whether rollback (`setLocalDescription({ type: 'rollback' })`) is executing.            | `src/core/network/WebRTCMesh.ts` (`isPolitePeer`, `handleRemoteDescription`)            |
| `iceConnectionState` transitions to `'failed'` after Wi-Fi roaming     | Network route invalidated; IP address changed; stale ICE credentials and bindings.                          | Verify whether automated ICE restart executed (`restartIce()`) with exponential backoff.                                                     | `src/core/network/WebRTCMesh.ts` (`onconnectionstatechange`, `restartIce`)              |
| Media or Large DataChannel packets drop; high packet loss with low RTT | Path MTU (PMTU) constriction; packet fragmentation dropped by intermediate VPN or cellular tunnel.          | Inspect SCTP/DataChannel payload chunking size; examine browser network dumps for ICMP "Fragmentation Needed" drops.                         | `src/core/network/WebRTCMesh.ts` (DataChannel 16 KiB chunk framing)                     |
| Peer connection teardown after 3 failed retries                        | Connection failed and exceeded `maxIceRestarts` ceiling (default: 3).                                       | Check console log: `onPeerDisconnect(peerId)`. Inspect whether TURN relay fallback was available.                                            | `src/core/network/WebRTCMesh.ts` (lines 192–207)                                        |

---

## 3. Diagnostic Workflow Using `chrome://webrtc-internals`

Google Chrome and Chromium-based browsers provide a built-in diagnostic interface at `chrome://webrtc-internals`. This tool captures real-time API traces, SDP session descriptions, ICE candidate pairs, and BWE (Bandwidth Estimation) time-series metrics.

> [!NOTE]
> Exact UI labels, tab names, and field arrangements may vary slightly between Chrome browser versions (e.g., Chrome 120 vs. 130+).

### 3.1 Step-by-Step Diagnostic Capture Procedure

1. **Pre-flight Setup:**
   - Open a dedicated tab and navigate to `chrome://webrtc-internals` **before** opening the WorkSphere workspace or initiating mesh calls.
   - Keep the diagnostic tab active in the background.

2. **Reproduce the Incident:**
   - Open WorkSphere in a second tab.
   - Have multiple nomad clients join the same collaborative space or initiate mesh calling simultaneously.

3. **Locate Target Peer Connection:**
   - In `chrome://webrtc-internals`, peer connections appear in the sidebar or top tab list labeled by internal IDs (e.g., `RTCPeerConnection (id: 1, url: ...)`).
   - Expand the connection details. WorkSphere's DataChannel mesh identifies channels by label:
     - `fileTransfer` indicates `WebRTCMesh.ts` DataChannel.
   - In the API trace table, look for `createDataChannel("fileTransfer")` or `addTrack` calls to identify the relevant instance.

4. **Inspect Signaling State Transitions:**
   - Review the chronological API trace in the left/upper pane.
   - A healthy negotiation follows:
     $$\text{stable} \longrightarrow \text{have-local-offer} \longrightarrow \text{stable}$$
     (when local peer is offerer), or:
     $$\text{stable} \longrightarrow \text{have-remote-offer} \longrightarrow \text{stable}$$
     (when local peer is answerer).
   - **Glare Signature:** If `setLocalDescription(offer)` is immediately followed by a remote offer arriving before the answer, observe whether `setLocalDescription({ type: 'rollback' })` is invoked (polite peer) or the remote offer is suppressed (impolite peer).

5. **Inspect ICE Gathering and Connection States:**
   - Look for `icegatheringstatechange` events: `new` $\rightarrow$ `gathering` $\rightarrow$ `complete`.
   - Look for `iceconnectionstatechange` events: `new` $\rightarrow$ `checking` $\rightarrow$ `connected` (or `completed`).
   - If the state transitions to `disconnected` or `failed`, note the exact elapsed milliseconds from `checking`.

6. **Inspect Candidate Pairs and Transport Selection:**
   - Scroll down to the statistics tables for `IceCandidatePair` and `IceCandidate`.
   - Identify the selected candidate pair (look for `nominated = true` and `state = succeeded`, or highlighted bold row).
   - Inspect:
     - `localCandidateId` and `remoteCandidateId`.
     - `candidateType`: `host` (local interface), `srflx` (STUN public IP), or `relay` (TURN relay).
     - `protocol`: `udp` vs `tcp`.
     - `currentRoundTripTime`, `bytesSent`, `bytesReceived`, and `packetsLost`.

7. **Export Diagnostic Dump:**
   - At the top of `chrome://webrtc-internals`, expand **"Create Dump"**.
   - Check **"Download the WebRTC internals dump"**.
   - Save the generated `.json` file for inclusion in maintainer escalation reports.

### 3.2 Interpreting Diagnostic States

```
                +-------------------+
                |       new         |
                +---------+---------+
                          |
                          v
                +-------------------+
                |     checking      |
                +----+---------+----+
                     |         |
      Valid pair found         | Timeout / No pair
                     v         v
     +-------------------+   +-------------------+
     |     connected     |   |      failed       |
     +---------+---------+   +---------+---------+
               |                       |
    Network change / timeout           | restartIce()
               v                       v
     +-------------------+   +-------------------+
     |   disconnected    |   |   reconnecting    |
     +-------------------+   +-------------------+
```

- **Failed Candidate Pair:** Indicated by candidate pairs where `requestsSent > 0`, `responsesReceived = 0`, and `state = failed`. This occurs when NAT firewalls block UDP hole punching.
- **Successful Selected Pair:** Marked with `nominated = true`, `state = succeeded`, and active incrementing byte counts.
- **Gathering Delays:** If `icegatheringstatechange` takes $>2500\text{ms}$ to transition to `complete`, local interface resolution or STUN response latency is lagging.
- **Repeated Negotiation Loops:** Multiple alternating `setLocalDescription(offer)` and `rollback` events occurring within $<1000\text{ms}$ indicate uncoordinated renegotiation races.

### 3.3 Diagnostic Triage Checklist for Bug Reports

When escalating a WebRTC connection failure, ensure the following artifacts are collected:

- [ ] Complete `chrome://webrtc-internals` diagnostic dump JSON.
- [ ] Browser version and OS build (e.g., Chrome 128.0.6613.120 on macOS Sonoma / Windows 11).
- [ ] Number of peers joining simultaneously.
- [ ] Exact console output including `[WebRTCMesh]` prefixes.
- [ ] Network topology description (e.g., symmetric corporate NAT, mobile hotspot, VPN).
- [ ] Sanitized SDP offers and answers from the trace.

---

## 4. Polite vs. Impolite Peer Negotiation

WebRTC connections operate under a symmetric offer/answer state model. When two peers attempt to negotiate or renegotiate at the exact same moment (glare), neither can process the other's offer if their signaling state has already transitioned to `have-local-offer`.

To solve this deterministically without deadlocks, WorkSphere implements the **W3C Perfect Negotiation Pattern** (RFC 8829 §3.5).

### 4.1 Concept and Roles

- **Offer Glare:** The condition where both peers generate and dispatch an SDP offer concurrently before receiving an offer from the other.
- **The Polite Peer:** When an offer collision occurs, the polite peer yields. It aborts its own pending local offer by executing an explicit rollback (`pc.setLocalDescription({ type: 'rollback' })`), applies the remote offer with `pc.setRemoteDescription()`, generates an answer, and returns to `stable`.
- **The Impolite Peer:** When an offer collision occurs, the impolite peer insists on its own pending offer. It ignores the incoming collision offer (`peer.ignoreOffer = true`), does not alter its local state, and waits for the polite peer to accept its original offer and return an answer.

### 4.2 Actual Implementation in `src/core/network/WebRTCMesh.ts`

In `WebRTCMesh.ts`, role assignment is **static and deterministic**, calculated from the peer IDs using a lexicographical string comparison:

```typescript
// src/core/network/WebRTCMesh.ts: lines 50-52
export function isPolitePeer(
  localPeerId: string,
  remotePeerId: string,
): boolean {
  return localPeerId < remotePeerId;
}
```

Because string ordering is total and antisymmetric, for any pair of peers $(A, B)$ where $A \neq B$, exactly one peer evaluates `localPeerId < remotePeerId` as `true` and becomes polite; the other evaluates to `false` and becomes impolite. Both sides arrive at this role without communicating.

#### Collision Detection and Rollback Handling

Inside `handleRemoteDescription(peerId, description)`:

```typescript
// src/core/network/WebRTCMesh.ts: lines 641-667
const offerCollision =
  description.type === "offer" &&
  (peer.makingOffer || pc.signalingState !== "stable");

peer.ignoreOffer = !peer.polite && offerCollision;
if (peer.ignoreOffer) {
  // Impolite peer insists on its own offer and drops the collision.
  return;
}

// This remote description supersedes any local offer still in flight.
peer.negotiationId++;

try {
  if (offerCollision && peer.polite) {
    // Polite peer yields: roll back its local offer, then accept.
    await pc.setLocalDescription({ type: "rollback" });
  }

  await pc.setRemoteDescription(description);

  if (description.type === "offer") {
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.signaling?.sendDescription(peerId, pc.localDescription ?? answer);
  }

  await this.flushPendingCandidates(peerId);
} catch (err) {
  console.error(
    `[WebRTCMesh] Failed to apply remote description from ${peerId}:`,
    err,
  );
}
```

#### Token-Based In-Flight Superseding

To prevent race conditions where a local offer was generated asynchronously while a remote offer was in transit, `WebRTCMesh` uses a monotonic `peer.negotiationId` counter:

```typescript
// src/core/network/WebRTCMesh.ts: lines 255-273
const negotiationId = ++peer.negotiationId;
peer.makingOffer = true;
try {
  const offer = await pc.createOffer(offerOptions);
  if (peer.negotiationId !== negotiationId || pc.signalingState !== "stable") {
    return; // Superseded by incoming remote description
  }
  await pc.setLocalDescription(offer);
  if (peer.negotiationId !== negotiationId) {
    return; // Superseded mid-flight
  }
  this.signaling?.sendDescription(peerId, pc.localDescription ?? offer);
} finally {
  peer.makingOffer = false;
}
```

### 4.3 Comparison: `WebRTCMesh.ts` vs `useWebRTCMesh.ts`

Maintainers must note that WorkSphere contains two distinct implementations of peer negotiation:

| Feature / Property     | `WebRTCMesh.ts` (DataChannel Mesh)                                                                          | `useWebRTCMesh.ts` (A/V Call Hook)                                                   |
| :--------------------- | :---------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------- |
| **Primary Scope**      | Multi-hop DataChannel transport, file transfer, CRDT mesh.                                                  | Audio/Video/Screen-sharing rooms (up to 6 peers).                                    |
| **Role Assignment**    | Lexicographical ID comparison: `localPeerId < remotePeerId`.                                                | Dynamic room-join order: `polite = isInitiator` (peer receiving `peer-join`).        |
| **In-Flight Discard**  | Token-based (`peer.negotiationId` check before & after `setLocalDescription`).                              | Boolean flag (`makingOffer`).                                                        |
| **Candidate Queueing** | `peer.pendingCandidates` buffered and flushed on `onsignalingstatechange` and after `setRemoteDescription`. | Discarded if received while `state.ignoreOffer` is active; no explicit buffer queue. |

### 4.4 Mermaid Sequence Diagram: Simultaneous Offer Collision

The following sequence diagram illustrates two peers (`PeerA` and `PeerB`, where `"peer-a" < "peer-b"`) generating simultaneous offers, resolving via perfect negotiation rollback:

```mermaid
sequenceDiagram
    autonumber
    participant PeerA as Peer A (Polite: "peer-a")
    participant Sig as PartyKit Signaling
    participant PeerB as Peer B (Impolite: "peer-b")

    Note over PeerA, PeerB: Tie-Breaker: "peer-a" < "peer-b" => Peer A is Polite, Peer B is Impolite

    par Simultaneous Local Offers
        PeerA->>PeerA: onnegotiationneeded: createOffer()
        PeerA->>PeerA: setLocalDescription(Offer_A) [signalingState: have-local-offer]
        PeerA->>Sig: sendDescription(Offer_A)
    and
        PeerB->>PeerB: onnegotiationneeded: createOffer()
        PeerB->>PeerB: setLocalDescription(Offer_B) [signalingState: have-local-offer]
        PeerB->>Sig: sendDescription(Offer_B)
    end

    Note over Sig: Cross-traffic exchange over WebSocket

    par In-flight Collision Delivery
        Sig->>PeerA: deliver(Offer_B)
        Sig->>PeerB: deliver(Offer_A)
    end

    rect rgb(240, 248, 255)
        Note over PeerA: Polite Collision Handling (Peer A)
        PeerA->>PeerA: Detects offerCollision (signalingState != 'stable')
        PeerA->>PeerA: Yields: setLocalDescription({ type: 'rollback' }) [signalingState: stable]
        PeerA->>PeerA: setRemoteDescription(Offer_B) [signalingState: have-remote-offer]
        PeerA->>PeerA: createAnswer() & setLocalDescription(Answer_A) [signalingState: stable]
        PeerA->>Sig: sendDescription(Answer_A)
        PeerA->>PeerA: flushPendingCandidates("peer-b")
    end

    rect rgb(255, 245, 245)
        Note over PeerB: Impolite Collision Handling (Peer B)
        PeerB->>PeerB: Detects offerCollision (signalingState != 'stable')
        PeerB->>PeerB: Impolite peer: ignoreOffer = true
        PeerB-->>PeerB: Discards Offer_A; keeps Offer_B active in have-local-offer
    end

    Sig->>PeerB: deliver(Answer_A)

    rect rgb(240, 255, 240)
        Note over PeerB: Answer Processing (Peer B)
        PeerB->>PeerB: setRemoteDescription(Answer_A) [signalingState: stable]
        PeerB->>PeerB: flushPendingCandidates("peer-a")
    end

    Note over PeerA, PeerB: Both peers return to signalingState: 'stable' without deadlock.
```

---

## 5. STUN/TURN Configuration and Fallback

### 5.1 Actual Repository Configuration

In the current WorkSphere codebase:

- **Default STUN Server:** Hardcoded across core network modules to Google's public STUN service:
  ```typescript
  // src/core/network/WebRTCMesh.ts: lines 118-120
  const config: RTCConfiguration = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  };
  ```
- **Hooks Configuration:** `src/hooks/useWebRTCMesh.ts` (line 126) also hardcodes:
  ```typescript
  const ICE_SERVERS: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
  ];
  ```
- **Environment Variables:** There are **no** environment variables (e.g., no `NEXT_PUBLIC_TURN_URL` or `STUN_SERVER_URL`) wired into `WebRTCMesh.ts` or `useWebRTCMesh.ts`.
- **Dynamic Credentials:** Neither static nor dynamically fetched TURN credentials exist in the primary mesh constructors.

### 5.2 Standalone Reconnect Managers & Fallback Infrastructure

While `WebRTCMesh.ts` does not contain dynamic STUN-to-TURN server fallback, WorkSphere provides modular fallback state machines in:

1. `src/core/webrtc/IceReconnectManager.ts`
2. `src/lib/webrtc/iceReconnectManager.ts`

These managers support injection of `fallbackIceServers?: RTCIceServer[]` via configuration options:

```typescript
// src/lib/webrtc/iceReconnectManager.ts: lines 87-90
fallbackIceServers: config?.fallbackIceServers ?? [
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun2.l.google.com:19302" },
];
```

When an `RTCPeerConnection` remains stuck in `iceConnectionState === 'checking'` for more than `checkingFallbackMs` (default: 5000ms), or reaches the retry threshold ($\ge 2$ consecutive reconnect attempts), `applyFallbackIceServers()` is executed:

```typescript
// src/lib/webrtc/iceReconnectManager.ts: lines 216-224
private applyFallbackIceServers(): void {
  if (!this.peerConnection) return;
  try {
    this.peerConnection.setConfiguration({
      ...this.peerConnection.getConfiguration(),
      iceServers: [...this.config.fallbackIceServers],
    });
    this.fallbackApplied = true;
  } catch (err) {
    console.error('Failed to apply fallback ICE servers', err);
  }
}
```

> [!IMPORTANT]
> **Source-of-Truth Clarification:** `WebRTCMesh.ts` does **not** automatically switch from STUN to TURN or invoke `setConfiguration()` upon failure. Its recovery consists exclusively of calling `restartIce()` with exponential backoff on the existing `iceServers` configuration. Relay fallback requires maintainers to configure `ICEReconnectManager` or pass custom `RTCIceServer` configurations.

### 5.3 Operational Verification and Diagnostic Steps

#### Verifying Direct vs Relay Connectivity in `chrome://webrtc-internals`

1. Locate the active `candidate-pair` table.
2. Inspect `localCandidateType` and `remoteCandidateType`:
   - `host` $\leftrightarrow$ `host`: Direct LAN/Wi-Fi connection (optimal, sub-5ms latency).
   - `srflx` $\leftrightarrow$ `srflx`: Direct peer connection traversed via STUN NAT binding.
   - `relay` $\leftrightarrow$ `relay` (or `relay` $\leftrightarrow$ `srflx`): Traversed through TURN relay.
3. If symmetric NAT prevents direct hole punching and no `relay` candidates are gathered:
   - ICE connection state transitions to `failed`.
   - The connection will not recover until a TURN server is added.

#### Operational Testing Guidelines

- **Testing UDP Restrictions:** Verify whether outbound UDP port 3478 (STUN) or 19302 is permitted by the local firewall:
  ```powershell
  Test-NetConnection -ComputerName stun.l.google.com -Port 19302
  ```
- **Checking Relay Credentials:** If custom TURN servers are deployed, ensure ephemeral credentials (RFC 5766 / REST API time-limited tokens) match the expected timestamp format. Never commit static credentials to git.

---

## 6. MTU and Packet Fragmentation Considerations

### 6.1 Network MTU vs. Real-Time WebRTC Traffic

The Maximum Transmission Unit (MTU) specifies the largest physical datagram (in bytes) that can pass through an IP network link without fragmentation:

- **Standard Ethernet MTU:** 1,500 bytes.
- **IPv6 Minimum Guaranteed MTU (RFC 8200):** 1,280 bytes.
- **Mobile Cellular & VPN Tunnels (WireGuard, IPsec, GRE):** Often depress effective Path MTU (PMTU) to between 1,200 and 1,380 bytes due to encapsulation headers.

### 6.2 The Fragmentation Hazard

WebRTC data channels run over **SCTP (Stream Control Transmission Protocol)** encapsulated in **DTLS (Datagram Transport Layer Security)** over **UDP**:

$$\text{IPv4 Header (20 B)} + \text{UDP Header (8 B)} + \text{DTLS Overhead (13--29 B)} + \text{SCTP Common Header (12 B)} \approx 60\text{--}70\text{ bytes}$$

If an unfragmented datagram exceeds PMTU:

1. Many network intermediate routers and firewalls drop IP datagrams with the `DF` (Don't Fragment) bit set without returning ICMP "Packet Too Big" notifications (Path MTU discovery black holes).
2. If IP fragmentation does occur, the loss of any single fragment drops the entire datagram, causing high packet loss rates, jitter spikes, and buffer stalls.

### 6.3 Application Payload Limits vs Transport MTU

- **Repository Implementation:** WorkSphere utilizes 16 KiB ($16,384\text{ bytes}$) chunking in its high-level DataChannel file and object transfer protocols (`src/lib/webrtc/packetChunker.ts: DEFAULT_CHUNK_SIZE = 16 * 1024`).
- **Underlying SCTP Segmentation:** 16 KiB is an **application-layer framing boundary**, not an IP MTU. The browser's native WebRTC SCTP implementation automatically segments 16 KiB buffers into datagrams that fit the underlying PMTU (typically $\approx 1,200\text{ bytes}$).
- **Maintainer Caution:** Avoid pushing large synchronous buffers ($>64\text{ KiB}$) directly to `RTCDataChannel.send()` in `WebRTCMesh.ts`, as this can saturate the SCTP send buffer (`bufferedAmount`), trigger browser backpressure errors, or cause head-of-line blocking for time-sensitive sync messages.

---

## 7. Recovery Procedures

Follow these ordered, non-destructive operational procedures when resolving connection failures.

### 7.1 Procedure A: Peer Stuck in `iceConnectionState: 'checking'`

1. **Initial Inspection:**
   - In `chrome://webrtc-internals`, verify whether STUN candidates (`srflx`) were harvested.
   - Inspect local candidates: if only `host` candidates appear, outbound STUN requests are blocked.
2. **Expected Evidence:**
   - Console: No `connected` state event received within 5,000ms.
   - Trace: `iceConnectionState: checking` with 0 candidate pair responses received.
3. **Recovery Action:**
   - Verify client device is not on a corporate guest network that drops UDP traffic.
   - Check if `startCheckingFallback` in `IceReconnectManager` triggered an automated ICE restart.
   - Trigger a manual ICE restart via the application interface or call:
     ```typescript
     mesh.restartIce(targetPeerId);
     ```
4. **Escalation:**
   - If repeated restarts fail after 3 attempts, escalate for TURN relay deployment.

---

### 7.2 Procedure B: Simultaneous Offer Glare Deadlock

1. **Initial Inspection:**
   - Inspect console logs for both peers. Look for:
     `[WebRTCMesh] Failed to apply remote description` or `InvalidStateError`.
2. **Expected Evidence:**
   - Both peers report `makingOffer: true` or have `signalingState: 'have-local-offer'`.
3. **Recovery Action:**
   - Ensure `isPolitePeer(localPeerId, remotePeerId)` yields opposing boolean states on each client.
   - Verify the polite peer successfully called:
     ```typescript
     await pc.setLocalDescription({ type: "rollback" });
     ```
   - If a peer's signaling state became permanently desynchronized due to an unhandled rejection, close the specific peer connection cleanly without tearing down the entire mesh:
     ```typescript
     mesh.onPeerDisconnect(targetPeerId);
     // Signaling will automatically recreate the peer when the next peer-join is received
     ```
4. **Escalation:**
   - Escalate to maintainers if `signalingState` remains stuck in `have-remote-offer` without sending an answer.

---

### 7.3 Procedure C: Recovering from Wi-Fi/Cellular Network Switch

1. **Initial Inspection:**
   - Client roamed from Wi-Fi to cellular data.
   - Connection state transitioned to `disconnected` or `failed`.
2. **Expected Evidence:**
   - `WebRTCMesh` logs:
     `[WebRTCMesh] ICE failed for <peerId> — attempting restart`
   - `iceRestartCount` increments (1, 2, 3).
3. **Recovery Action:**
   - `WebRTCMesh` automatically executes `restartIce()` with exponential backoff:
     $$\text{backoff} = \min\left(1000\text{ms} \times 2^{\text{iceRestartCount} - 1},\, 8000\text{ms}\right)$$
   - Allow up to 15 seconds for ICE gathering on the new cellular interface.
   - Do **not** reload the browser window immediately, as premature reloads flood PartyKit with duplicate `peer-join` signals.
4. **Escalation:**
   - If after 3 restarts the connection transitions to `closed`, verify whether cellular carrier blocks WebRTC traffic.

---

### 7.4 Procedure D: Burst Simultaneous Mesh Joins ($N \ge 4$)

1. **Initial Inspection:**
   - 4 or more nomad clients join the same room within the same 500ms window.
   - Signaling message volume spikes ($O(N^2)$ offers/answers).
2. **Expected Evidence:**
   - High RTT reported in `useWebRTCMesh` ping loop ($>300\text{ms}$).
   - Some peers report `Max peers reached, cannot connect`.
3. **Recovery Action:**
   - Observe the soft ceiling: `useWebRTCMesh.ts` caps concurrent A/V peers at 5 remote peers (6 total participants).
   - In `WebRTCMesh.ts`, ensure `peer.pendingCandidates` is correctly queueing candidates while connections are negotiating.
   - If signaling is overwhelmed, introduce staggered join delays (e.g. 100–300ms random jitter) at the application room entry level.

---

## 8. Logging and Evidence Collection

### 8.1 Existing Repository Log Signatures

The following log strings are emitted by the current implementation and should be searched in browser developer consoles:

| Log Signature                                                             | Source File & Line                           | Meaning                                                       |
| :------------------------------------------------------------------------ | :------------------------------------------- | :------------------------------------------------------------ |
| `[WebRTCMesh] Failed to negotiate with <peerId>:`                         | `src/core/network/WebRTCMesh.ts:276`         | Error during `createOffer` or `setLocalDescription`.          |
| `[WebRTCMesh] Failed to flush queued ICE candidate for <peerId>:`         | `src/core/network/WebRTCMesh.ts:299`         | Candidate rejected during flushing (e.g. invalid SDP mid).    |
| `[WebRTCMesh] Failed to apply remote description from <peerId>:`          | `src/core/network/WebRTCMesh.ts:670`         | Glare collision error or SDP syntax failure.                  |
| `[WebRTCMesh] Failed to add ICE candidate from <peerId>:`                 | `src/core/network/WebRTCMesh.ts:700`         | Immediate candidate application error.                        |
| `[WebRTCMesh] ICE failed for <peerId> — attempting restart`               | `src/hooks/useWebRTCMesh.ts:371`             | Hook caught `failed` state and initiated `restartIce()`.      |
| `[ICE] gathering timed out in <ms>ms ...`                                 | `src/core/webrtc/IceReconnectManager.ts:66`  | Gathering exceeded 2500ms timeout window.                     |
| `[ICE] still "checking" - applying STUN/TURN fallback and restarting ICE` | `src/core/webrtc/IceReconnectManager.ts:113` | Checking state exceeded 5000ms threshold; fallback triggered. |

### 8.2 Recommended Maintainer Debug Logging

When diagnosing persistent issues in staging environments, maintainers can enable verbose logging by adding the following debug instrumentation:

```typescript
pc.onicecandidateerror = (event: any) => {
  console.warn(
    `[ICE-ERROR] host=${event.hostCandidate}, url=${event.url}, code=${event.errorCode}, text=${event.errorText}`,
  );
};
```

---

## 9. Common Failure Scenarios Matrix

| Scenario / Phenomenon             | Root Cause                                                                                   | Observable Evidence                                                               | Action / Mitigation                                                                   | Confirmation Status                              |
| :-------------------------------- | :------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------ | :----------------------------------------------- |
| **Deadlock on Simultaneous Join** | Symmetric offer generation without rollback yielding.                                        | Signaling state stuck in `have-local-offer`; `InvalidStateError` in console.      | Ensure `isPolitePeer` role assignment is respected and rollback executes.             | **Confirmed** in `WebRTCMesh.ts`                 |
| **Symmetric NAT Drop**            | NAT firewall maps different external ports for different destinations; STUN binding invalid. | `iceConnectionState: failed`; candidate pair `responsesReceived = 0`.             | Deploy TURN server with TCP/443 relay; inject into `fallbackIceServers`.              | **Confirmed** (No TURN in default config)        |
| **Stale Candidates on Roaming**   | Client switches Wi-Fi without restarting ICE; sends stale IP candidate.                      | Connection drops to `disconnected`; data channel silent.                          | Automatic ICE restart triggers via backoff timer (up to 3 attempts).                  | **Confirmed** in `WebRTCMesh.ts` (lines 192–207) |
| **Candidate Race Condition**      | ICE candidates arrive before SDP offer/answer over WebSocket.                                | Console error: `Failed to execute 'addIceCandidate': remote description is null`. | Buffer candidates in `peer.pendingCandidates` until `setRemoteDescription` completes. | **Confirmed** in `WebRTCMesh.ts` (lines 690–694) |
| **DataChannel Buffer Exhaustion** | Sending large sync updates without flow control.                                             | `bufferedAmount` steadily rises; UI stalls; eventual channel closure.             | Use 16 KiB chunk framing and respect backpressure events (`bufferedamountlow`).       | **Confirmed** (Payload chunking implemented)     |

---

## 10. Escalation and Bug Report Template

Maintainers receiving escalated WebRTC mesh incidents should require bug reports formatted with the following markdown template:

```markdown
### WebRTC Mesh Renegotiation Failure Report

**Environment Details:**

- WorkSphere Commit / Version: [e.g. beeff59a]
- Browser Name & Version: [e.g. Chrome 128.0.6613.120 (64-bit)]
- Operating System: [e.g. macOS 14.6.1 / Windows 11 23H2]
- Network Architecture: [e.g. Corporate 802.1x Wi-Fi behind Symmetric NAT / Dual-stack IPv6]

**Incident Overview:**

- Number of Concurrent Joining Peers: [e.g. 4 peers]
- Mesh Type: [DataChannel Mesh (`WebRTCMesh`) / A/V Call (`useWebRTCMesh`)]
- Failure Frequency: [Always / Intermittent under load / Roaming only]

**Observed States & Behavior:**

- Local Peer ID: `peer-xxxx`
- Remote Peer ID: `peer-yyyy`
- Calculated Polite Role: [Polite / Impolite]
- Final Signaling State: [e.g. have-local-offer]
- Final ICE Connection State: [e.g. checking / failed]
- Selected Candidate Pair: [e.g. None / host-host]

**Console Logs (Sanitized):**
```

[Paste relevant [WebRTCMesh] console logs here]

```

**Diagnostic Attachments:**
- [ ] Sanitized `chrome://webrtc-internals` dump attached (IP addresses and personal identifiers redacted).
- [ ] No TURN credentials or internal tokens included.
```

---

## 11. Limitations and Security Considerations

### 11.1 Diagnostic Dump Redaction and Privacy

`chrome://webrtc-internals` diagnostic dumps record comprehensive network state, including:

- Local private IPv4 addresses (e.g. `192.168.1.x`, `10.x.x.x`).
- Public server-reflexive IP addresses (`srflx`), revealing geographic location and ISP.
- Local MAC addresses and interface identifiers embedded in IPv6 link-local addresses.
- User agents, internal device hardware hashes, and active PartyKit room IDs.

> [!CAUTION]
> Before attaching diagnostic dumps to public GitHub issues or public Slack/Discord channels, **maintainers must sanitize the JSON file**. Replace actual IP octets with dummy masks (e.g., `192.0.2.1` or `RFC 5737` documentation ranges).

### 11.2 TURN Credential Security

- TURN servers authenticate via usernames and HMAC credentials.
- **Never** paste static TURN passwords or production auth secrets into runbooks, issue templates, or source code.
- If dynamic TURN credentials are used, inspect the dump to verify that token strings or HMAC secrets are stripped before sharing.

### 11.3 Limits of In-Browser Diagnostics

Browser-level diagnostics (`chrome://webrtc-internals` and console logs) provide client visibility only. They cannot:

- Diagnose silent packet drops inside carrier-grade NAT (CGNAT) routers.
- Verify intermediate firewall stateful inspection timeouts (e.g., aggressive UDP timeout windows $<30\text{s}$).
- Inspect TLS packet flow when DTLS handshakes fail due to corrupted system clocks or cipher mismatches.
  For deep network path diagnosis, complementary tools such as Wireshark (`pcap` captures on the `udp.port == 19302` or DTLS protocol filters) may be required.
