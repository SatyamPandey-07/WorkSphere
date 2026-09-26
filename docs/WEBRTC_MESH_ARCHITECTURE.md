# WebRTC Mesh Connection Lifecycle

> **Source:** `src/hooks/useWebRTCMesh.ts`  
> **Signaling:** `party/server.ts` — PartyKit handles all SDP/ICE relay  
> **See also:** [`WEBRTC_MESH.md`](./WEBRTC_MESH.md) — topology, ICE server config, troubleshooting

---

## 1. Offer/Answer Exchange (SDP Negotiation)

When Peer 2 joins a room already occupied by Peer 1, a Perfect Negotiation handshake begins. WorkSphere uses the **polite/impolite peer** model to resolve simultaneous-offer collisions:

- **Polite peer (established participant):** Yields if both peers generate an offer at the same time — rolls back its own SDP and accepts the remote offer.
- **Impolite peer (new joiner):** Ignores conflicting offers and prioritizes its own state.

```mermaid
sequenceDiagram
    participant P1 as Peer 1 (Polite)
    participant Sig as PartyKit Signaling
    participant P2 as Peer 2 (Impolite)

    P2->>Sig: { kind: "peer-join" }
    Sig->>P1: Forwarded peer-join event

    P1->>P1: createOffer()
    P1->>Sig: { kind: "offer", sdp: RTCSessionDescription }
    Sig->>P2: Forwarded offer

    P2->>P2: setRemoteDescription(offer)
    P2->>P2: createAnswer()
    P2->>Sig: { kind: "answer", sdp: RTCSessionDescription }
    Sig->>P1: Forwarded answer

    P1->>P1: setRemoteDescription(answer)
    Note over P1,P2: SDP negotiation complete — ICE begins
```

---

## 2. ICE Candidate Trickling

ICE candidates are gathered and exchanged in parallel during SDP negotiation. Both peers gather candidates from the STUN server and send them as they are discovered.

```mermaid
sequenceDiagram
    participant P1 as Peer 1
    participant Sig as PartyKit Signaling
    participant P2 as Peer 2

    par ICE gathering — Peer 1
        P1->>P1: onicecandidate fires
        P1->>Sig: { kind: "ice", candidate }
        Sig->>P2: Forwarded ICE candidate
        P2->>P2: addIceCandidate(candidate)
    and ICE gathering — Peer 2
        P2->>P2: onicecandidate fires
        P2->>Sig: { kind: "ice", candidate }
        Sig->>P1: Forwarded ICE candidate
        P1->>P1: addIceCandidate(candidate)
    end

    Note over P1,P2: DTLS handshake after ICE pair selected
    Note over P1,P2: Direct P2P media begins — Signaling exits path
```

---

## 3. Audio Track Attachment

Once the DTLS handshake completes, the remote audio track arrives via the `ontrack` event and is routed through the WebAudio spatial graph.

```mermaid
sequenceDiagram
    participant P1 as Peer 1
    participant AudioCtx as AudioContext (P2's side)

    P1->>P2: RTCPeerConnection fires ontrack
    P2->>AudioCtx: createMediaStreamSource(remoteStream)
    AudioCtx->>AudioCtx: source → GainNode → PannerNode → destination
    Note over P2,AudioCtx: Spatial audio active — HRTF binaural rendering
```

---

## 4. Peer Disconnect & Reconnect Backoff

`useWebRTCMesh` monitors `oniceconnectionstatechange` on every `RTCPeerConnection`. When a peer's connection state transitions to `"disconnected"` or `"failed"`, a cleanup + exponential backoff reconnect cycle begins.

```mermaid
sequenceDiagram
    participant P1 as Peer 1
    participant P2 as Peer 2 (disconnecting)
    participant Hook as useWebRTCMesh

    P2->>P2: Network drops / browser tab closes
    P1->>Hook: oniceconnectionstatechange = "disconnected"
    Hook->>Hook: cleanupPeer(P2) — close pc, release audio
    Note over Hook: backoff = min(attempt² × 1s, 30s)
    Hook->>P1: Attempt reconnect after backoff
    P1->>P1: New RTCPeerConnection for P2
    P1->>P2: { kind: "offer" } via PartyKit
    Note over P1,P2: Reconnect cycle up to MAX_RETRIES attempts
```

### Backoff parameters

| Attempt | Delay |
|---------|-------|
| 1 | 1 s |
| 2 | 4 s |
| 3 | 9 s |
| max | 30 s |

---

## 5. Signal Message Types

| Message kind | Direction | Purpose |
|---|---|---|
| `peer-join` | Server → peers | New peer joined the PartyKit room |
| `offer` | Peer → Peer (via server) | SDP offer from polite peer |
| `answer` | Peer → Peer (via server) | SDP answer from impolite peer |
| `ice` | Peer → Peer (via server) | ICE candidate trickle |
| `peer-leave` | Server → peers | Peer disconnected; trigger cleanup |
