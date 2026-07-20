# WebRTC Mesh Networking Guide

This document describes the proposed WebRTC mesh networking architecture for WorkSphere. It explains the peer-to-peer connection lifecycle, SDP offer/answer negotiation, ICE candidate exchange using STUN/TURN servers, PartyKit-based signaling, media track constraints, and recommended network fallback behavior.

The current repository includes PartyKit-based real-time infrastructure for coordination and presence. The WebRTC workflow described below represents a recommended architecture for future peer-to-peer media communication.

---

## 1. Architecture Overview

The proposed communication architecture combines WebRTC for peer-to-peer media transmission with PartyKit for signaling and connection coordination.

### Components

- **WebRTC** – Establishes direct peer-to-peer audio/video or data connections.
- **PartyKit** – Exchanges signaling messages such as SDP offers, SDP answers, and ICE candidates between peers.
- **STUN Server** – Discovers the client's public network address for NAT traversal.
- **TURN Server** – Relays media traffic when a direct peer-to-peer connection cannot be established.
- **Application Layer** – Manages session state, participant information, and connection lifecycle.

### High-Level Connection Flow

```text
Peer A
   │
   │ Create Offer
   ▼
PartyKit Signaling
   │
   ▼
Peer B
   │
   │ Create Answer
   ▼
PartyKit Signaling
   │
   ▼
Peer A
   │
 ICE Candidate Exchange
   │
   ▼
Direct WebRTC Connection
```
---

## 2. Peer-to-Peer Connection Lifecycle

The proposed WebRTC connection lifecycle consists of signaling, negotiation, connectivity checks, media establishment, and connection termination.

### Connection Stages

1. **Session Initialization**
   - A participant requests to join a communication session.
   - PartyKit coordinates signaling between peers.

2.2. **Offer Creation**
   - The initiating peer creates an SDP offer.
   - The offer is applied using `setLocalDescription()`.
   - The offer is transmitted through PartyKit signaling.
3. **Answer Generation**
   - The receiving peer sets the remote offer using `setRemoteDescription()`.
   - An SDP answer is generated.
   - The answer is applied using `setLocalDescription()`.
   - The SDP answer is returned through PartyKit.

4. **ICE Candidate Exchange**
   - Both peers exchange ICE candidates.
   - STUN and TURN servers assist with NAT traversal and relay when necessary.

5. **Connection Establishment**
   - ICE connectivity checks determine the optimal communication path.
   - After successful negotiation, a direct peer-to-peer connection is established whenever possible.

6. **Media Transmission**
   - Audio, video, or data tracks begin streaming between peers.
   - PartyKit is no longer responsible for media transport after negotiation completes.

7. **Session Termination**
   - Media tracks are stopped.
   - Peer connections are closed.
   - Signaling state is cleaned up to release session resources.

### Lifecycle Summary

```text
Join Session
      │
      ▼
Create SDP Offer
      │
      ▼
PartyKit Signaling
      │
      ▼
Receive SDP Answer
      │
      ▼
Exchange ICE Candidates
      │
      ▼
Connectivity Checks
      │
      ▼
Direct Peer Connection
      │
      ▼
Media Streaming
      │
      ▼
Connection Closed
```
---

## 3. SDP Offer / Answer Flow

Session Description Protocol (SDP) is used to negotiate communication parameters between peers before media transmission begins. The signaling server forwards SDP messages but does not process or modify their contents.

### Negotiation Sequence

1. Peer A creates an `RTCPeerConnection`.
2. Peer A generates an SDP offer.
3. The SDP offer is sent to Peer B through PartyKit signaling.
4. Peer B sets the received offer as the remote description.
5. Peer B generates an SDP answer.
6. The SDP answer is sent back through PartyKit.
7. Peer A sets the received answer as the remote description.
8. ICE candidate exchange begins.

### SDP Flow Diagram

```text
Peer A                        PartyKit                     Peer B
  │                               │                          │
  │ Create SDP Offer              │                          │
  ├──────────────────────────────►│                          │
  │                               ├─────────────────────────►│
  │                               │                          │
  │                               │      Create Answer       │
  │                               │◄─────────────────────────┤
  │◄──────────────────────────────┤                          │
  │ Set Remote Description        │                          │
  │                               │                          │
  │ ICE Candidate Exchange Begins │                          │
```

### Expected SDP Information

Typical SDP negotiation includes:

- Media capabilities
- Supported codecs
- Encryption parameters
- Network transport information
- Media stream identifiers

PartyKit is responsible only for forwarding signaling messages between participants. Media traffic flows directly between peers whenever a direct connection is available.
---

## 4. STUN/TURN & ICE Candidate Exchange

Interactive Connectivity Establishment (ICE) enables peers to discover the best available network path for communication. Candidate information is exchanged through PartyKit signaling during connection setup.

1. Each peer gathers local ICE candidates.
2. STUN servers help determine the public IP address and port.
3. ICE candidates are exchanged through PartyKit.
4. If ICE candidates arrive before the remote description is available, they are temporarily queued.
5. After `setRemoteDescription()` completes, queued candidates are applied using `addIceCandidate()`.
6. Connectivity checks are performed for all candidate pairs.
7. The best working candidate pair is selected.
8. If no direct candidate pair succeeds, TURN relays the media traffic.

### Candidate Exchange Flow

```text
Peer A                    PartyKit                    Peer B
   │                          │                         │
   │ Local ICE Candidate      │                         │
   ├─────────────────────────►│                         │
   │                          ├────────────────────────►│
   │                          │                         │
   │                          │ Local ICE Candidate    │
   │◄─────────────────────────┤                         │
   │                          │◄────────────────────────┤
   │                          │                         │
   │ Connectivity Checks      │                         │
   │─────────────── Direct Connection ────────────────►│
```

### STUN

STUN (Session Traversal Utilities for NAT) helps a peer discover its public-facing IP address and port, allowing direct peer-to-peer communication whenever network conditions permit.

### TURN

TURN (Traversal Using Relays around NAT) provides a relay server when a direct peer-to-peer connection cannot be established because of restrictive NATs or firewalls. Although TURN introduces additional latency and bandwidth usage, it improves connection reliability.

### Candidate Preference

ICE gathers multiple candidate types and performs connectivity checks in parallel. The final connection is selected based on successful ICE checks rather than a fixed sequential fallback order.

1. Host candidates
2. Server reflexive (STUN) candidates
3. Relay (TURN) candidates
---

## 5. PartyKit Signaling

PartyKit acts as the signaling layer for coordinating WebRTC connection setup. It is responsible for delivering signaling messages between peers but does not carry media streams.

### Responsibilities

- Coordinate session initialization
- Forward SDP offers
- Forward SDP answers
- Forward ICE candidates
- Track participant presence
- Notify peers about connection state changes

### Signaling Flow

```text
Peer A
   │
   │ SDP Offer
   ▼
PartyKit
   │
   ▼
Peer B

Peer B
   │
   │ SDP Answer
   ▼
PartyKit
   │
   ▼
Peer A

Both Peers
   │
   │ ICE Candidates
   ▼
PartyKit
   │
   ▼
Both Peers
```

### Signaling Characteristics

- PartyKit is used only during connection negotiation.
- Media traffic does not pass through PartyKit after a peer-to-peer connection has been established.
- Presence and session coordination may continue through PartyKit independently of media transmission.

> **Note:** The repository currently contains PartyKit-based infrastructure for real-time coordination and presence. The WebRTC signaling workflow described here represents the recommended architecture for peer-to-peer communication and complements the existing PartyKit components.
---

## 6. Media Track Constraint Options

Media constraints allow applications to specify the desired properties for audio and video streams before they are captured.

### Example Constraints

| Media Type | Common Options |
|------------|----------------|
| Audio | Echo cancellation, noise suppression, auto gain control |
| Video | Width, height, frame rate, camera facing mode |
| Screen Share | Display surface, cursor visibility, frame rate |

### Typical Configuration Goals

- Prioritize clear audio for meetings.
- Adjust video resolution based on network quality.
- Reduce bandwidth usage on slower connections.
- Allow screen sharing when required.
- Gracefully disable unavailable media devices.

---

## 7. Network Fallback Rules

Reliable communication requires fallback mechanisms when ideal network conditions are unavailable.

### Recommended Fallback Order

1. Direct peer-to-peer connection.
2. STUN-assisted NAT traversal.
3. TURN relay server.
4. Notify the application if connectivity cannot be established.

### Failure Handling

### Failure Handling

- Retry signaling if negotiation fails.
- Use `RTCPeerConnection.restartIce()` when an established connection loses connectivity.
- Perform a new SDP offer/answer exchange after restarting ICE.
- Recreate the peer connection only if ICE restart cannot recover the session.
- Clean up inactive sessions.
- Allow participants to reconnect gracefully.

### Network Priority

```text
Direct Peer Connection
        │
        ▼
STUN-Assisted Connection
        │
        ▼
TURN Relay
        │
        ▼
Connection Failure Notification
```

---

## 8. Summary

The proposed architecture combines:

- WebRTC for peer-to-peer media transmission.
- PartyKit for signaling and session coordination.
- STUN for public address discovery.
- TURN for reliable fallback connectivity.
- SDP negotiation for session establishment.
- ICE candidate exchange for selecting the optimal communication path.

This design separates signaling from media transport, enabling efficient peer-to-peer communication while retaining reliable coordination through PartyKit. The WebRTC workflow described in this guide represents a recommended architecture that complements the repository's existing PartyKit-based real-time infrastructure.