# WorkSphere Documentation

Welcome to the WorkSphere documentation hub. Use the topic-based sections below to find setup instructions, API contracts, architecture references, feature guides, and operational documentation.

- [Clerk Webhook Integration Runbook](./auth/CLERK_WEBHOOK_INTEGRATION.md) — signature verification, event handling, secret rotation, local testing, and troubleshooting.

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
- [Smart Desk Sensor Telemetry Payload Specification & Protobuf Definitions](./iot/TELEMETRY_PAYLOAD_SPEC.md) — JSON telemetry payload schemas, Protocol Buffers definitions, HMAC-SHA256 webhook authentication, timestamp replay protection, and electrical power anomaly thresholds.
- [Seat Hold Lease Extension API](./api/SEAT_HOLD_LEASE_EXTENSION.md) — seat-lock lease extension, fencing-token validation, and API response behavior.
- [Anonymous ZKP Check-In OpenAPI 3.1 Specification](./api/zkp-checkin.openapi.yaml) — anonymous check-in proof and response contract.
- [Venue Amenity Voting OpenAPI 3.1 Specification](./api/amenity-votes.openapi.yaml) — amenity metrics and vote submission contract.

- [Causal Vector Clock Specification](./architecture/CAUSAL_VECTOR_CLOCK_SPEC.md) — application-level vector clock semantics, conflict ordering, and safe pruning requirements.

## Architecture & Distributed Systems

- [Architecture Documentation Index](./architecture/README.md) — system design references, distributed coordination, and architecture notes.
- [Multi-Agent AI Architecture](./ARCHITECTURE.md) — agent orchestration, decision pipeline, and application-level AI architecture.
- [Causal Ordering & Deterministic Tie-Breaking](./architecture/CAUSAL_ORDERING_AND_TIEBREAKING.md) — Vector Clock partial order mathematics, Hybrid Logical Clock tie-breaking heuristics, and distributed partition reconciliation.
- [GossipSub WebRTC Mesh](./architecture/GOSSIPSUB_WEBRTC_MESH.md) — peer discovery, GossipSub parameters, heartbeat intervals, and mesh behavior.
- [GossipSub IP Colocation & Sybil Defense](./architecture/GOSSIPSUB_IP_COLOCATION.md) — subnet colocation scoring (/24 IPv4 and /48 IPv6), Sybil mitigation, exponential decay, and mesh pruning.
- [WebRTC Signaling Handshake Runbook](./p2p/WEBRTC_SIGNALING_HANDSHAKE.md) — PartyKit signaling, offer/answer exchange, trickle ICE, STUN/TURN traversal, Perfect Negotiation, and troubleshooting.
- [WebRTC ICE Candidate Gathering & STUN/TURN Topology](./p2p/WEBRTC_ICE_TRAVERSAL.md) — ICE candidate gathering, STUN discovery, candidate types, timeout bounds, TURN relay topology, and firewall troubleshooting.
- [Distributed Locks and Fencing](./architecture/distributed-locks-and-fencing.md) — distributed lock coordination and fencing mechanisms.
- [Multi-Region Synchronization](./architecture/multi-region-sync.md) — synchronization across distributed application regions.

## Database & Infrastructure

- [Partition Backup Verification and Restore Drills](./database/PARTITION_BACKUP_VERIFICATION.md) — backup archive verification, coverage, freshness, and restore checks.
- [Database Partition Export and Archive Specification](./database/PARTITION_EXPORT_AND_ARCHIVE_SPECIFICATION.md) — partition export, archival lifecycle, and schema considerations.
- [PostgreSQL Partitioning Maintenance](./database/table-partitioning-maintenance.md) — partition maintenance, query optimization, and archival workflows.
- [Redis Keyspace](./database/REDIS_KEYSPACE.md) — Redis keyspace, TTL, and invalidation guidance.
- [Prisma Troubleshooting](./troubleshooting/prisma.md) — common Prisma and database troubleshooting guidance.
- [Spatial Geo-Query Guide](./search/SPATIAL_GEO_QUERY_GUIDE.md) — coordinate validation, bounding-box clamping, Haversine versus geodesic distance, PostGIS `ST_DWithin` radius queries, and GiST index behavior.

## Security & Cryptography

- [OAuth Refresh Token Rotation & Session Hijacking Mitigation Guide](./auth/REFRESH_TOKEN_ROTATION_GUIDE.md) — JWT access/refresh token rotation lifecycle, token family reuse detection, passwordChangedAt revocation, and cookie security.
- [Markdown Syntax Rendering & Collaborative Chat Formatting Specification](./chat/MARKDOWN_RENDERING_SPEC.md) — Collaborative chat input sanitization, generative UI regex tokenization, Zod schema validation, XSS prevention, and DOMPurify specification.
- [Security Architecture Overview](./security/SECURITY_OVERVIEW.md) — overview of application security defenses and their interaction.
- [Content Security Policy Nonce Architecture](./security/csp-nonce-architecture.md) — nonce-based CSP implementation and request security.
- [CSRF Protection Architecture](./security/csrf-protection-architecture.md) — CSRF protection and request validation design.
- [Double Ratchet Protocol](./security/DOUBLE_RATCHET_PROTOCOL.md) — encrypted messaging key evolution and protocol design.
- [Skipped Message Key Store Runbook](./chat/SKIPPED_MESSAGE_KEY_STORE.md) — skipped-key retention, out-of-order recovery, storage limits, pruning, and source-verified security limitations.
- [Zero-Knowledge Groth16 Proof Verification](./crypto/ZK_GROTH16_VERIFICATION.md) — zero-knowledge anonymous venue check-in architecture, Groth16 zk-SNARK pipeline, Poseidon nullifiers, and verification.
- [ZKP Verification Runbook](./security/ZKP_VERIFICATION_RUNBOOK.md) — Groth16 verification architecture and key rotation procedures.
- [Solana Escrow Settlement and Refund Runbook](./solana/ESCROW_SETTLEMENT_RUNBOOK.md) — escrow PDA derivation, confirmation levels, release and timeout refunds, and RPC failover.

## Features & Product Documentation

- [Reservation Flow Guide](./features/reservation-flow-guide.md) — reservation client workflow, validation, and lock management.
- [Venue Check-In Flow](./features/venue-checkin-flow.md) — QR verification, geofence proximity, and check-in behavior.
- [Venue WiFi Quality Scoring](./venues/WIFI_QUALITY_SCORING.md) — speed tiers, jitter and packet loss penalties, measurement telemetry, and badge display rules.
- [Venue Power Outlet Standards](./venues/POWER_OUTLET_STANDARDS.md) — outlet density and power type taxonomy, rating aggregation rules, amenity vote verification, and socket telemetry scoring.
- [Voice Search](./features/VOICE_SEARCH.md) — voice search feature documentation.
- [Seating Occupancy Forecasting](./features/seating-occupancy-forecasting.md) — seating occupancy forecasting functionality.
- [Nomad Passport](./features/nomad-passport.md) — Nomad Passport feature and product workflow.

## Audio & Acoustics

- [Ambient Noise Spectrogram Architecture](./audio/NOISE_SPECTROGRAM_ARCHITECTURE.md) — microphone capture, FFT processing, spectrum rendering, waterfall visualization, and audio lifecycle troubleshooting.
- [Acoustic Grading Specification](./audio/ACOUSTIC_GRADING_SPECIFICATION.md) — noise tier boundaries, dB, A-weighting and Leq calculations, Hann-windowed FFT sampling, RT60 reverberation, and crowd-sourced reading guidelines.

## UI Components & Frontend

- [Design System Guide](./DESIGN_SYSTEM_GUIDE.md) — design tokens, themes, components, and frontend styling conventions.
- [Theme Token Architecture](./ui/THEME_TOKEN_ARCHITECTURE.md) — complete CSS variable dictionary, dark mode, Cyberpunk Neon, high-contrast theming, and semantic token migration guide.
- [Accessibility Guide](./ACCESSIBILITY_GUIDE.md) — accessibility standards and implementation guidance.
- [Venue Action Glassmorphic Pulse Guide](./ui/GLASSMORPHIC_PULSE_GUIDE.md) — theme-specific venue action button animations, rendering, accessibility, and contrast analysis.
- [Breadcrumb Component](./components/Breadcrumb.md) — breadcrumb component behavior and usage.
- [Floor Plan Viewer 3D](./components/FloorPlanViewer3D.md) — 3D floor-plan viewer documentation.
- [Network Status Pill](./components/NetworkStatusPill.md) — network connectivity status component.

## Offline Support & Realtime Systems

- [PWA Service Worker Caching Strategy & Invalidation Runbook](./pwa/SERVICE_WORKER_CACHING_STRATEGY.md) — Progressive Web App service worker caching tiers, Workbox strategies, deployment versioning, background sync queues, and storage quota management.
- [IndexedDB Offline Sync Architecture](./offline/indexeddb-sync-architecture.md) — offline mutations, IndexedDB storage, and synchronization.
- [Dead Letter Queue](./offline/dead-letter-queue.md) — handling and recovery of failed offline jobs.
- [Offline Sync Flow](./architecture/offline-sync-flow.md) — application offline synchronization flow.
- [Local Mesh CRDT Synchronization](./realtime/local-mesh-crdt-sync.md) — collaborative state replication over peer-to-peer mesh connections.
- [CRDT Documentation Index](./crdt/README.md) — collaborative data protocols, specifications, and reading order.
- [Yjs State Vector Exchange & Differential Compaction Architecture](./crdt/YJS_SYNC_PROTOCOL.md) — complete Yjs state vector exchange (`Y.encodeStateVector`), differential update computation (`Y.encodeStateAsUpdate`), wire codecs, and snapshot compaction engine.
- [Ephemeral Awareness Vector Clock Compaction](./crdt/AWARENESS_VECTOR_COMPACTION.md) — ephemeral presence tracking, 30s TTL heartbeat eviction, and awareness vector compaction vs. document-level garbage collection.

## Testing, Monitoring & Operations

- [Playwright Testing Guide](./testing/PLAYWRIGHT_GUIDE.md) — end-to-end testing for booking workflows.
- [End-to-End Playwright Guide](./testing/e2e-playwright.md) — browser-based end-to-end testing documentation.
- [Web Vitals Guide](./telemetry/web-vitals-guide.md) — Core Web Vitals thresholds and performance telemetry.
- [Vitals Export Pipeline](./telemetry/vitals-export-pipeline.md) — telemetry export and operational pipeline.
- [WebGPU Fallback Triage Runbook](./runbooks/WEBGPU_FALLBACK_TRIAGE.md) — diagnosing WebGPU device loss and fallback behavior.
- [Reservation CDC Operations](./workers/RESERVATION_CDC_OPERATIONS.md) — PostgreSQL logical replication and Redis Stream operations.
- [Troubleshooting](./TROUBLESHOOTING.md) — common development and operational troubleshooting guidance.
- [WebGPU Capability Diagnostics](./telemetry/WEBGPU_CAPABILITY_DIAGNOSTICS.md) — capability report schema, privacy controls, API submission, and administrator troubleshooting.

## Analytics & Sustainability

- [Commuter Carbon Savings Guide](./analytics/CARBON_SAVINGS_GUIDE.md) — emission factor baselines, avoided-emissions formulas, transit mode differentials, date range presets, and CSV and team badge SVG exports.
- [Carbon Calculation Methodology](./analytics/CARBON_CALCULATION_METHODOLOGY.md) — mode calculator constants, formulas and properties, a step-by-step transit comparison, and how the factor tables differ.
- [GHG Scope 3 Methodology](./sustainability/ghg-scope-3-methodology.md) — GHG Protocol Scope 3 framing, carbon engine implementation, and ESG audit CSV contract.

## Export & Reporting

- [CSV and Excel Export Architecture Developer Guide](./export/CSV_EXCEL_EXPORT_GUIDE.md) — Comprehensive developer reference for typed CSV and Excel XML export builders, RFC-4180 escaping, formula injection sanitization, and browser download handling.
- [Booking Itinerary & PDF Verification System](./export/booking-pdf-generation.md) — Specification and architecture for booking receipts, vector QR matrix generation, and cryptographic verification seals.

## UI Components & Frontend

- [NotificationBell Component Guide](./NOTIFICATION_BELL_GUIDE.md) — Top navigation notification bell, live polling, optimistic mark-as-read, undo restoration, and backend API contract.
