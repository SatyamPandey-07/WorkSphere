# WorkSphere P2P Mesh Specification

## 1. Overview

WorkSphere utilizes WebRTC DataChannels coupled with a GossipSub routing topology (`src/core/p2p/GossipSubRouter.ts`) to enable peer discovery and state synchronization in local or offline mesh networks.

---

## 2. WebRTC Data Channel Handshake & Discovery

````mermaid
sequenceDiagram
    autonumber
    participant PeerA as Peer A (Initiator)
    participant Signal as Signaling Server / Local Multicast
    participant PeerB as Peer B (Receiver)

    PeerA->>Signal: Send SDP Offer + ICE Candidates
    Signal->>PeerB: Forward SDP Offer
    PeerB->>Signal: Send SDP Answer + ICE Candidates
    Signal->>PeerA: Forward SDP Answer
    Note over PeerA,PeerB: Direct WebRTC DataChannel Connection Established
    PeerA->>PeerB: Mesh HELLO (PeerID, Protocol Version, Capabilities)
    PeerB->>PeerA: Mesh HELLO_ACK (PeerID, Known Topologies)

    ### 3.1 Envelope Schema Definition

```json
{
  "$schema": "[http://json-schema.org/draft-07/schema#](http://json-schema.org/draft-07/schema#)",
  "title": "WorkSphereP2PPacket",
  "type": "object",
  "properties": {
    "header": {
      "type": "object",
      "properties": {
        "version": { "type": "string", "enum": ["1.0.0"] },
        "messageId": { "type": "string", "format": "uuid" },
        "senderPeerId": { "type": "string" },
        "recipientPeerId": { "type": ["string", "null"] },
        "timestamp": { "type": "integer" },
        "ttl": { "type": "integer", "minimum": 1, "maximum": 64 },
        "signature": { "type": "string" }
      },
      "required": ["version", "messageId", "senderPeerId", "timestamp", "ttl", "signature"]
    },
    "payload": {
      "type": "object",
      "properties": {
        "type": { "type": "string", "enum": ["GOSSIP_SUB", "HEARTBEAT", "STATE_SYNC", "DTN_BUNDLE"] },
        "topic": { "type": "string" },
        "data": { "type": "object" }
      },
      "required": ["type", "topic", "data"]
    }
  },
  "required": ["header", "payload"]
}
````
