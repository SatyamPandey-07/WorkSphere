# API Documentation

This directory contains endpoint-specific API contracts and operational guidance.

## OpenAPI specifications

- [Anonymous ZKP check-in](./zkp-checkin.openapi.yaml) — Groth16 proof payloads, public signals, nullifier replay protection, and check-in responses.
- [Venue amenity voting](./amenity-votes.openapi.yaml) — amenity metrics and vote submission contracts.

## Guides

- [Date filter formats](./DATE_FILTER_FORMATS.md) — supported calendar dates, RFC 3339 timestamps, relative windows, aliases, and 400 error responses.
- [Rate limiting](./RATE_LIMITING.md) — active middleware quotas, the separate tiered configuration, 429 headers, and client retry examples.
- [Seat Hold Lease Extension](./SEAT_HOLD_LEASE_EXTENSION.md) — authenticated seat-lock extension, lease constraints, fencing-token validation, and error responses.
- [Bookings](./bookings.md)
- [Cafe orders](./cafe-orders.md)
- [Message translation](./message-translation.md)
- [Partition export](./partition-export.md)
- [Partition management](./partition-management.md) — scheduled maintenance, bulk archive and deletion, and administrative audit endpoints.
- [Semantic search](./semantic-search.md)
- [Solana Pay](./solana-pay.md)
- [Telemetry](./telemetry.md)
- [WebGPU Capability Diagnostics](../telemetry/WEBGPU_CAPABILITY_DIAGNOSTICS.md) — WebGPU capability telemetry schema, diagnostics API, and operational guidance.
- [Venue flagging](./VENUE_FLAGGING.md) — authenticated flag submission, reason validation, duplicate behavior, and hourly rate limit.
- [Venue reviews](./venue-reviews.md) — cursor-based review pagination, viewer-dependent reviewer details, and response behavior.

For project-wide endpoint and stream documentation, see [the REST API reference](../API.md).
