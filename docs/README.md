# WorkSphere Documentation

## API reference

- [API documentation index](./api/README.md)
- [Anonymous ZKP check-in OpenAPI 3.1 specification](./api/zkp-checkin.openapi.yaml)
- [Venue amenity voting OpenAPI 3.1 specification](./api/amenity-votes.openapi.yaml)

## Security

- [Security architecture overview](./security/SECURITY_OVERVIEW.md)
- [Escrow smart contract threat model and audit specification](./security/ESCROW_SMART_CONTRACT_THREAT_MODEL.md) — STRIDE analysis, PDA collision resistance, replay defenses, emergency freeze design, and Trident/Anchor fuzzing guidance
- [Solana gasless relayer threat model](./security/solana-relayer-threat-model.md)
- [Cryptographic booking receipt specification](./security/cryptographic-receipt-spec.md)
- [WebAuthn passkey security guide](./security/passkey-webauthn-guide.md)

- [WebGPU acoustic simulation](./audio/WEBGPU_ACOUSTIC_SIMULATION.md) — WGSL bindings, buffer layouts, stackless BVH traversal, CPU fallback and benchmarking.

## Edge runtime

- [Distributed Bloom limiter](./edge/DISTRIBUTED_BLOOM_LIMITER.md) — counting Bloom filter fallback rate limiter: sliding window decay math, hash derivation, false positive sizing, gossip sync, configuration profiles and middleware integration.

## WebRTC

- [ICE reconnect state machine](./webrtc/ICE_RECONNECT_STATE_MACHINE.md) — `ICEReconnectManager` states and Mermaid diagram, backoff and jitter math, disconnect grace period, ICE restart and trickle ICE, fallback ICE servers, telemetry events, and troubleshooting for strict NATs and corporate firewalls.

## P2P

- [GossipSub peer scoring](./p2p/GOSSIPSUB_PEER_SCORING.md) — `GossipSubPeerScorer` score formula (P1 to P4, IP colocation, app-specific), default weights, decay half-lives, gating thresholds, Sybil mitigation, tuning guidance and extension examples.
