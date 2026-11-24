# GossipSub Sybil & Eclipse Attack Mitigation

## Overview
Protects serverless WebRTC nomad rooms from Sybil flooding and Eclipse isolation by pairing reputation scoring with IP subnet colocation limits.

## Key Controls
- **Scoring & Pruning:** Penalize invalid signatures and prune low-score peers per [BFT Peer Discovery](./BFT_PEER_DISCOVERY.md).
- **Subnet Caps:** Restrict peers per `/24` and `/48` prefix and integrate enforcement in `src/lib/p2p/meshCollabEngine.ts`.