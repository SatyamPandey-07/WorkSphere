# API Documentation

This directory contains endpoint-specific API contracts and operational guidance.

## OpenAPI specifications

- [Anonymous ZKP check-in](./zkp-checkin.openapi.yaml) — Groth16 proof payloads, public signals, nullifier replay protection, and check-in responses.
- [Venue amenity voting](./amenity-votes.openapi.yaml) — amenity metrics and vote submission contracts.

## Guides

- [Date filter formats](./DATE_FILTER_FORMATS.md) — supported calendar dates, RFC 3339 timestamps, relative windows, aliases, and 400 error responses.
- [Rate limiting](./RATE_LIMITING.md) — active middleware quotas, the separate tiered configuration, 429 headers, and client retry examples.
- [Bookings](./bookings.md)
- [Cafe orders](./cafe-orders.md)
- [Message translation](./message-translation.md)
- [Partition export](./partition-export.md)
- [Semantic search](./semantic-search.md)
- [Solana Pay](./solana-pay.md)
- [Telemetry](./telemetry.md)

For project-wide endpoint and stream documentation, see [the REST API reference](../API.md).
