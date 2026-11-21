# WorkSphere Documentation

## API reference

- [API documentation index](./api/README.md)
- [Anonymous ZKP check-in OpenAPI 3.1 specification](./api/zkp-checkin.openapi.yaml)
- [Venue amenity voting OpenAPI 3.1 specification](./api/amenity-votes.openapi.yaml)
- [GossipSub WebRTC Mesh](architecture/GOSSIPSUB_WEBRTC_MESH.md) — GossipSub parameters,
  heartbeat intervals, peer score metrics, and IHAVE/IWANT lifecycle.

## Export & Reporting

- [CSV and Excel Export Architecture Developer Guide](./export/CSV_EXCEL_EXPORT_GUIDE.md) — Comprehensive developer reference for typed CSV and Excel XML export builders, RFC-4180 escaping, formula injection sanitization, and browser download handling.
- [Booking Itinerary & PDF Verification System](./export/booking-pdf-generation.md) — Specification and architecture for booking receipts, vector QR matrix generation, and cryptographic verification seals.

## Contributing & Release

- [Release Process](./contributing/RELEASE_PROCESS.md) — Tag-triggered GitHub draft releases, review, and publication.

- [GitHub Actions CI Workflow](./contributing/CI_WORKFLOW.md) — CI triggers, build and test jobs, blocking and advisory checks, and PR validation.

## Database & Operations

- [Partition Backup Verification and Restore Drills](./database/PARTITION_BACKUP_VERIFICATION.md) — Verify partition backup archives, coverage and freshness, and run guarded disposable-database restore checks.

## Workers & Operations

- [Reservation CDC Setup and Operations](./workers/RESERVATION_CDC_OPERATIONS.md) — Configure, run, monitor, and troubleshoot PostgreSQL logical replication and Redis Stream publishing.
