# Architecture Documentation

Architecture decisions, implementation notes, and system-level design references for WorkSphere.

## Reservation and reliability

- [Atomic desk reservation countdown and Redis keyspace](./atomic-desk-reservation-countdown-redis-keyspace.md)
- [Distributed locks and fencing](./distributed-locks-and-fencing.md)
- [Redlock lease fencing token protocol](./REDLOCK_FENCING_TOKENS.md)
- [DST-safe reservation durations](./DST_SAFE_RESERVATIONS.md)
- [Seat hold lock architecture](./seat-hold-lock-architecture.md)
- [Seat hold Redlock architecture](./seat-hold-lock-redlock-architecture.md)
- [Token-bucket Redis TTL fallback and recovery](./TOKEN_BUCKET_REDIS_FALLBACK.md)
- [Rate limiting strategies](./rate-limiting-strategies.md)
- [Sliding-window rate limiting](./sliding-window-rate-limiting.md)

- [CRDT state-vector checksum reconnect protocol](../crdt/STATE_VECTOR_CHECKSUM_PROTOCOL.md)

## Application architecture

- [ADR-004: Dual PostGIS spatial and trigram venue search](./ADR-004-spatial-phonetic-venue-search.md)
- [Distributed WebRTC mesh signaling and STUN/TURN fallback](./WEBRTC_MESH_SIGNALING.md)
- [Middleware routing](./middleware-routing.md)
- [Multi-region sync](./multi-region-sync.md)
- [Causal vector-clock specification](./CAUSAL_VECTOR_CLOCK_SPEC.md)
- [Offline sync flow](./offline-sync-flow.md)
- [Reminder cron pipeline](./reminder-cron-pipeline.md)

## Database and cache operations

- [Redis keyspace and TTL invalidation](../database/REDIS_KEYSPACE.md)
