# Peer-to-Peer & WebRTC Documentation Index

Welcome to the WorkSphere peer-to-peer (P2P) and WebRTC documentation hub. This directory contains architectural specifications, signaling runbooks, ICE traversal guides, and media tuning references for decentralized real-time mesh collaboration.

---

## Documents

- [WebRTC Peer Connection Lifecycle & ICE Candidate Negotiation](./mesh-lifecycle.md) — Comprehensive technical reference on peer connection lifecycles, state machines, SDP offer/answer negotiation, Trickle ICE, STUN/TURN fallback, DataChannel management, and local multi-device debugging.
- [WebRTC Signaling Handshake Runbook](./WEBRTC_SIGNALING_HANDSHAKE.md) — PartyKit signaling, offer/answer exchange, trickle ICE, STUN/TURN traversal, Perfect Negotiation, and troubleshooting.
- [WebRTC ICE Candidate Gathering & STUN/TURN Topology](./WEBRTC_ICE_TRAVERSAL.md) — ICE candidate gathering, STUN discovery, candidate types, timeout bounds, TURN relay topology, and firewall troubleshooting.
- [GossipSub Peer Scoring & Subnet Colocation](./GOSSIPSUB_PEER_SCORING.md) — Subnet colocation scoring, Sybil defense, heartbeat intervals, and mesh maintenance.
- [WebRTC DataChannel Chunking Runbook](./DATACHANNEL_CHUNKING_RUNBOOK.md) — Large binary and string message chunking over ordered RTCDataChannels, reassembly protocols, and backpressure management.
- [Opus Audio Tuning & Adaptive Jitter Buffer Reference](../webrtc/OPUS_AUDIO_TUNING.md) — Opus packet-loss concealment (PLC), in-band forward error correction (FEC), WebRTC jitter-buffer telemetry, and WorkSphere's adaptive bitrate step ladder.
