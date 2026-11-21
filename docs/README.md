# WorkSphere Documentation

Welcome to the WorkSphere documentation hub. Use the topic-based sections below to find setup instructions, API contracts, architecture references, feature guides, and operational documentation.

## Getting Started & Contributor Guides

- [Repository contribution guide](../CONTRIBUTING.md) — contribution workflow, development expectations, and pull request guidelines.
- [Getting Started & Environment Setup](./setup.md) — prerequisites, supported versions, environment configuration, and local setup.
- [Local Development Setup](./guides/LOCAL_DEVELOPMENT_SETUP.md) — Docker, PostgreSQL, and Redis infrastructure for local development.
- [Local Database Setup](./getting-started/local-database-setup.md) — database preparation for contributors.
- [Issue Claiming Guide](./contributing/claiming-issues.md) — issue claiming, assignment limits, and contribution workflow.
- [GitHub Actions CI Workflow](./contributing/CI_WORKFLOW.md) — CI triggers, build and test jobs, and pull request checks.
- [Release Process](./contributing/RELEASE_PROCESS.md) — tag-triggered draft releases, review, and publication.

## API Reference & OpenAPI Specifications

- [API Documentation Index](./api/README.md) — endpoint-specific API contracts and operational guides.
- [REST API & Real-Time Streams](./API.md) — REST endpoints, authentication, request and response schemas, and event streams.
- [API Reference](./API_REFERENCE.md) — high-level endpoint reference organized by feature.
- [Anonymous ZKP Check-In OpenAPI 3.1 Specification](./api/zkp-checkin.openapi.yaml) — anonymous check-in proof and response contract.
- [Venue Amenity Voting OpenAPI 3.1 Specification](./api/amenity-votes.openapi.yaml) — amenity metrics and vote submission contract.

## Architecture & Distributed Systems

- [Architecture Documentation Index](./architecture/README.md) — system design references, distributed coordination, and architecture notes.
- [Multi-Agent AI Architecture](./ARCHITECTURE.md) — agent orchestration, decision pipeline, and application-level AI architecture.
- [GossipSub WebRTC Mesh](./architecture/GOSSIPSUB_WEBRTC_MESH.md) — peer discovery, GossipSub parameters, heartbeat intervals, and mesh behavior.
- [Distributed Locks and Fencing](./architecture/distributed-locks-and-fencing.md) — distributed lock coordination and fencing mechanisms.
- [Multi-Region Synchronization](./architecture/multi-region-sync.md) — synchronization across distributed application regions.

## Database & Infrastructure

- [Partition Backup Verification and Restore Drills](./database/PARTITION_BACKUP_VERIFICATION.md) — backup archive verification, coverage, freshness, and restore checks.
- [Database Partition Export and Archive Specification](./database/PARTITION_EXPORT_AND_ARCHIVE_SPECIFICATION.md) — partition export, archival lifecycle, and schema considerations.
- [PostgreSQL Partitioning Maintenance](./database/table-partitioning-maintenance.md) — partition maintenance, query optimization, and archival workflows.
- [Redis Keyspace](./database/REDIS_KEYSPACE.md) — Redis keyspace, TTL, and invalidation guidance.
- [Prisma Troubleshooting](./troubleshooting/prisma.md) — common Prisma and database troubleshooting guidance.

## Security & Cryptography

- [Security Architecture Overview](./security/SECURITY_OVERVIEW.md) — overview of application security defenses and their interaction.
- [Content Security Policy Nonce Architecture](./security/csp-nonce-architecture.md) — nonce-based CSP implementation and request security.
- [CSRF Protection Architecture](./security/csrf-protection-architecture.md) — CSRF protection and request validation design.
- [Double Ratchet Protocol](./security/DOUBLE_RATCHET_PROTOCOL.md) — encrypted messaging key evolution and protocol design.
- [ZKP Verification Runbook](./security/ZKP_VERIFICATION_RUNBOOK.md) — Groth16 verification architecture and key rotation procedures.

## Features & Product Documentation

- [Reservation Flow Guide](./features/reservation-flow-guide.md) — reservation client workflow, validation, and lock management.
- [Venue Check-In Flow](./features/venue-checkin-flow.md) — QR verification, geofence proximity, and check-in behavior.
- [Voice Search](./features/VOICE_SEARCH.md) — voice search feature documentation.
- [Seating Occupancy Forecasting](./features/seating-occupancy-forecasting.md) — seating occupancy forecasting functionality.
- [Nomad Passport](./features/nomad-passport.md) — Nomad Passport feature and product workflow.

## UI Components & Frontend

- [Design System Guide](./DESIGN_SYSTEM_GUIDE.md) — design tokens, themes, components, and frontend styling conventions.
- [Accessibility Guide](./ACCESSIBILITY_GUIDE.md) — accessibility standards and implementation guidance.
- [Breadcrumb Component](./components/Breadcrumb.md) — breadcrumb component behavior and usage.
- [Floor Plan Viewer 3D](./components/FloorPlanViewer3D.md) — 3D floor-plan viewer documentation.
- [Network Status Pill](./components/NetworkStatusPill.md) — network connectivity status component.

## Offline Support & Realtime Systems

- [IndexedDB Offline Sync Architecture](./offline/indexeddb-sync-architecture.md) — offline mutations, IndexedDB storage, and synchronization.
- [Dead Letter Queue](./offline/dead-letter-queue.md) — handling and recovery of failed offline jobs.
- [Offline Sync Flow](./architecture/offline-sync-flow.md) — application offline synchronization flow.
- [Local Mesh CRDT Synchronization](./realtime/local-mesh-crdt-sync.md) — collaborative state replication over peer-to-peer mesh connections.
- [CRDT Documentation Index](./crdt/README.md) — collaborative data protocols, specifications, and reading order.

## Testing, Monitoring & Operations

- [Playwright Testing Guide](./testing/PLAYWRIGHT_GUIDE.md) — end-to-end testing for booking workflows.
- [End-to-End Playwright Guide](./testing/e2e-playwright.md) — browser-based end-to-end testing documentation.
- [Web Vitals Guide](./telemetry/web-vitals-guide.md) — Core Web Vitals thresholds and performance telemetry.
- [Vitals Export Pipeline](./telemetry/vitals-export-pipeline.md) — telemetry export and operational pipeline.
- [WebGPU Fallback Triage Runbook](./runbooks/WEBGPU_FALLBACK_TRIAGE.md) — diagnosing WebGPU device loss and fallback behavior.
- [Reservation CDC Operations](./workers/RESERVATION_CDC_OPERATIONS.md) — PostgreSQL logical replication and Redis Stream operations.
- [Troubleshooting](./TROUBLESHOOTING.md) — common development and operational troubleshooting guidance.

## Export & Reporting

- [CSV and Excel Export Architecture Developer Guide](./export/CSV_EXCEL_EXPORT_GUIDE.md) — typed CSV and Excel XML export, escaping, formula injection sanitization, and browser downloads.
- [Booking Itinerary & PDF Verification System](./export/booking-pdf-generation.md) — booking receipts, QR generation, and cryptographic verification.

---

For detailed documentation within a topic, start with its category index where one is available, such as the API, Architecture, or CRDT documentation indexes.