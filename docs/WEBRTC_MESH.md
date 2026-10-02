# WebRTC Mesh Topology & ICE Server Configuration

> **Related:** [`WEBRTC_MESH_NETWORKING_GUIDE.md`](./WEBRTC_MESH_NETWORKING_GUIDE.md) — full peer connection lifecycle, SDP negotiation, and React integration  
> **Signaling:** `party/server.ts` — PartyKit handles all SDP/ICE relay

---

## Architecture Overview

WorkSphere uses a **full mesh** topology for peer-to-peer workspace presence. Each participant establishes a direct `RTCPeerConnection` to every other participant in the room. PartyKit acts as the signaling relay only — no media passes through the server.

```
       ┌──── PartyKit Signaling ────┐
       │  (SDP offer/answer, ICE)   │
       │                            │
  Peer A ◄──────────────────────► Peer B
     │  ◄── direct P2P media ──►   │
     │                              │
     └────────────── ► Peer C ◄─────┘
               (direct P2P)
```

| Topology | Max peers | Server load | Latency |
|----------|-----------|-------------|---------|
| Full mesh (current) | ~6–8 | None (media is P2P) | Minimal |
| SFU (future) | Unlimited | High | Low |

---

## ICE Server Configuration

WorkSphere uses STUN for NAT traversal in most cases. TURN is required for symmetric NAT and restrictive firewalls.

### Environment variables

```env
# Public STUN servers (no auth required)
NEXT_PUBLIC_STUN_SERVERS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302

# TURN server (required for restrictive NAT — set your own or use a cloud service)
TURN_SERVER_URL=turn:your-turn-server.example.com:3478
TURN_USERNAME=your-turn-username
TURN_CREDENTIAL=your-turn-password
```

### RTCConfiguration

```ts
const ICE_SERVERS: RTCIceServer[] = [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ...(process.env.TURN_SERVER_URL
    ? [
        {
          urls: process.env.TURN_SERVER_URL,
          username: process.env.TURN_USERNAME,
          credential: process.env.TURN_CREDENTIAL,
        },
      ]
    : []),
];

const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
```

### Graceful degradation

| Scenario | Behavior |
|----------|----------|
| STUN resolves (most home/office networks) | Direct P2P connection |
| Symmetric NAT (enterprise firewall) | Falls back to TURN relay |
| TURN unavailable | Connection fails; user shown a toast to try again |
| Peer disconnects mid-session | `oniceconnectionstatechange` fires `disconnected` → UI shows "reconnecting" |

---

## Connection Establishment Flow

1. **Initiator** creates an `RTCPeerConnection`, adds tracks, generates an SDP offer
2. Offer is sent via **PartyKit** `webrtc-signal` message to the target peer
3. **Responder** sets the remote description, generates an answer, sends it back
4. Both sides exchange ICE candidates via PartyKit until a candidate pair is established
5. Direct P2P media begins flowing; PartyKit is no longer in the media path

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| Connection stays at `checking` forever | Symmetric NAT, no TURN | Add a TURN server |
| `failed` ICE state after a few seconds | Firewall blocking UDP/TCP | Use TURN with TCP (`turn:server:443?transport=tcp`) |
| One-way audio | `ontrack` handler not wiring the stream to an audio element | Check `pc.ontrack` implementation |
| High latency | Relaying through TURN | Move TURN server geographically closer |
| Infinite reconnect loop | `iceConnectionState = "disconnected"` not debounced | Only restart ICE after a 2–3s grace period |

---

## Further Reading

- Full peer connection lifecycle: [`WEBRTC_MESH_NETWORKING_GUIDE.md`](./WEBRTC_MESH_NETWORKING_GUIDE.md)
- Spatial audio over WebRTC tracks: [`WEBAUDIO_SPATIAL_PANNER_MANUAL.md`](./WEBAUDIO_SPATIAL_PANNER_MANUAL.md)
- CRDT sync over the data channel: [`WEBRTC_MESH_CRDT_SYNC_SPECIFICATION.md`](./WEBRTC_MESH_CRDT_SYNC_SPECIFICATION.md)
