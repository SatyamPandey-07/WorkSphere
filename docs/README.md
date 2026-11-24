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
- [Arabic and Hebrew Right-to-Left (RTL) Localization Contributor Guide](./i18n/RTL_LOCALIZATION_GUIDE.md) — Tailwind 4 logical properties, dynamic `dir="rtl"` root document switching, and translation contribution checklist.

## API Reference & OpenAPI Specifications

- [API Documentation Index](./api/README.md) — endpoint-specific API contracts and operational guides.
- [REST API & Real-Time Streams](./API.md) — REST endpoints, authentication, request and response schemas, and event streams.
- [API Reference](./API_REFERENCE.md) — high-level endpoint reference organized by feature.
- [Smart Desk Sensor Telemetry Payload Specification & Protobuf Definitions](./iot/TELEMETRY_PAYLOAD_SPEC.md) — JSON telemetry payload schemas, Protocol Buffers definitions, HMAC-SHA256 webhook authentication, timestamp replay protection, and electrical power anomaly thresholds.
- [Seat Hold Lease Extension API](./api/SEAT_HOLD_LEASE_EXTENSION.md) — seat-lock lease extension, fencing-token validation, and API response behavior.
- [Anonymous ZKP Check-In OpenAPI 3.1 Specification](./api/zkp-checkin.openapi.yaml) — anonymous check-in proof and response contract.
- [Venue Amenity Voting OpenAPI 3.1 Specification](./api/amenity-votes.openapi.yaml) — amenity metrics and vote submission contract.
- [Prisma Database Aggregate Query Patterns](./api/PRISMA_AGGREGATION_GUIDE.md) — native database aggregates (`count`, `groupBy`), parallel execution with `Promise.all`, and index coverage for analytics endpoints.

- [Causal Vector Clock Specification](./architecture/CAUSAL_VECTOR_CLOCK_SPEC.md) — application-level vector clock semantics, conflict ordering, and safe pruning requirements.

## Architecture & Distributed Systems

- [Architecture Documentation Index](./architecture/README.md) — system design references, distributed coordination, and architecture notes.
- [Multi-Agent AI Architecture](./ARCHITECTURE.md) — agent orchestration, decision pipeline, and application-level AI architecture.

- [Semantic Matching Engine & Vector Indexing](./ai/SEMANTIC_MATCHING_ENGINE.md) — resume tokenization, dense vector embeddings, pgvector HNSW tuning, and cosine distance query benchmarks.

- [Causal Ordering & Deterministic Tie-Breaking](./architecture/CAUSAL_ORDERING_AND_TIEBREAKING.md) — Vector Clock partial order mathematics, Hybrid Logical Clock tie-breaking heuristics, and distributed partition reconciliation.
- [Logoot vs. LATA Sequence CRDT Comparison](./crdt/LOGOOOT_VS_LATA_COMPARISON.md) — comparative analysis of fractional positioning (Logoot) versus relative dependency trees (LATA), boundary growth, tombstone garbage collection, and memory overhead.

- [GossipSub WebRTC Mesh](./architecture/GOSSIPSUB_WEBRTC_MESH.md) — peer discovery, GossipSub parameters, heartbeat intervals, and mesh behavior.
- [WebRTC TURN Relay Bandwidth Throttle & Backpressure Specification](./architecture/WEBRTC_TURN_RELAY_THROTTLE.md) — candidate-pair relay detection, 48 kbps token-bucket rate limiting, priority queuing, and backpressure state transitions.
- [WebRTC Peer Connection Lifecycle & ICE Candidate Negotiation](./p2p/mesh-lifecycle.md) — complete peer connection lifecycles, 4-state browser state machine, SDP offer/answer exchange, Trickle ICE, STUN/TURN fallback, DataChannel lifecycle, diagnostic runbook, and multi-device development.
- [GossipSub IP Colocation & Sybil Defense](./architecture/GOSSIPSUB_IP_COLOCATION.md) — subnet colocation scoring (/24 IPv4 and /48 IPv6), Sybil mitigation, exponential decay, and mesh pruning.
- [WebRTC Signaling Handshake Runbook](./p2p/WEBRTC_SIGNALING_HANDSHAKE.md) — PartyKit signaling, offer/answer exchange, trickle ICE, STUN/TURN traversal, Perfect Negotiation, and troubleshooting.
- [WebRTC ICE Candidate Gathering & STUN/TURN Topology](./p2p/WEBRTC_ICE_TRAVERSAL.md) — ICE candidate gathering, STUN discovery, candidate types, timeout bounds, TURN relay topology, and firewall troubleshooting.
- [Distributed Locks and Fencing](./architecture/distributed-locks-and-fencing.md) — distributed lock coordination and fencing mechanisms.
- [Unified Distributed Locking and Fencing Token State Machine](./architecture/DISTRIBUTED_LOCKS_STATE_MACHINE.md) — current seat-hold authorities, formal lease states, recovery behavior, and proposed resource-side fencing requirements.
- [Multi-Region Synchronization](./architecture/multi-region-sync.md) — synchronization across distributed application regions.

## Database & Infrastructure

- [PostgreSQL Connection Pooling & Starvation Prevention Runbook](./db/CONNECTION_POOLING_RUNBOOK.md) — Prisma 7 connection pool architecture, driver adapter tuning, PgBouncer session vs. transaction pooling, serverless deployment sizing, interactive transaction discipline, and diagnostic SQL queries.
- [Partition Backup Verification and Restore Drills](./database/PARTITION_BACKUP_VERIFICATION.md) — backup archive verification, coverage, freshness, and restore checks.
- [Database Partition Export and Archive Specification](./database/PARTITION_EXPORT_AND_ARCHIVE_SPECIFICATION.md) — partition export, archival lifecycle, and schema considerations.
- [PostgreSQL Partitioning Maintenance](./database/table-partitioning-maintenance.md) — partition maintenance, query optimization, and archival workflows.
- [Redis Keyspace](./database/REDIS_KEYSPACE.md) — Redis keyspace, TTL, and invalidation guidance.
- [Prisma Troubleshooting](./troubleshooting/prisma.md) — common Prisma and database troubleshooting guidance.
- [Spatial Geo-Query Guide](./search/SPATIAL_GEO_QUERY_GUIDE.md) — coordinate validation, bounding-box clamping, Haversine versus geodesic distance, PostGIS `ST_DWithin` radius queries, and GiST index behavior.
- [PostGIS Spherical Bounding Box Index Tuning Guide](./geo/POSTGIS_INDEX_TUNING.md) — GiST indexing on geography(Point, 4326), ST_DWithin vs ST_DistanceSphere comparison, <-> KNN spatial search, and EXPLAIN ANALYZE tuning.

## Security & Cryptography

- [OAuth Refresh Token Rotation & Session Hijacking Mitigation Guide](./auth/REFRESH_TOKEN_ROTATION_GUIDE.md) — JWT access/refresh token rotation lifecycle, token family reuse detection, passwordChangedAt revocation, and cookie security.
- [Markdown Syntax Rendering & Collaborative Chat Formatting Specification](./chat/MARKDOWN_RENDERING_SPEC.md) — Collaborative chat input sanitization, generative UI regex tokenization, Zod schema validation, XSS prevention, and DOMPurify specification.
- [Security Architecture Overview](./security/SECURITY_OVERVIEW.md) — overview of application security defenses and their interaction.
- [Content Security Policy Nonce Architecture](./security/csp-nonce-architecture.md) — nonce-based CSP implementation and request security.
- [CSRF Protection Architecture](./security/csrf-protection-architecture.md) — CSRF protection and request validation design.
- [CSRF Double-Submit Cookie Verification Specification](./security/CSRF_PROTECTION_SPEC.md) — HMAC-SHA256 CSRF token structure, SameSite/HttpOnly cookie attributes, subdomain isolation, and mutation verification pipeline.
- [Double Ratchet Protocol](./security/DOUBLE_RATCHET_PROTOCOL.md) — encrypted messaging key evolution and protocol design.
- [Skipped Message Key Store Runbook](./chat/SKIPPED_MESSAGE_KEY_STORE.md) — skipped-key retention, out-of-order recovery, storage limits, pruning, and source-verified security limitations.
- [Zero-Knowledge Groth16 Proof Verification](./crypto/ZK_GROTH16_VERIFICATION.md) — zero-knowledge anonymous venue check-in architecture, Groth16 zk-SNARK pipeline, Poseidon nullifiers, and verification.
- [Circom Witness Generation Worker Pool Architecture](./zkp/CIRCOM_WITNESS_WORKER_POOL.md) — Web Worker thread offloading, BN254 elliptic curve constraints, watchdog timeouts, and WASM memory lifecycle.
- [Merchant Solana Escrow Settlement & Automated Refund Dispute Guide](./payments/solana-escrow.md) — non-custodial Solana escrow state machine, PDA derivation, deposit and settlement transactions, 2-of-3 multi-sig disputes, automated expiry refunds, and Devnet testing.
- [ZKP Verification Runbook](./security/ZKP_VERIFICATION_RUNBOOK.md) — Groth16 verification architecture and key rotation procedures.
- [Solana Escrow Settlement and Refund Runbook](./solana/ESCROW_SETTLEMENT_RUNBOOK.md) — escrow PDA derivation, confirmation levels, release and timeout refunds, and RPC failover.
- [Solana Durable Nonce Offline Signing Runbook](./solana/DURABLE_NONCE_OFFLINE_SIGNING.md) — persistent nonce account initialization, instruction ordering, offline transaction serialization, air-gapped signing workflows, and RPC recovery.

## Features & Product Documentation

- [Reservation Flow Guide](./features/reservation-flow-guide.md) — reservation client workflow, validation, and lock management.
- [Venue Check-In Flow](./features/venue-checkin-flow.md) — QR verification, geofence proximity, and check-in behavior.
- [Crowdsourced WiFi Speed Test Sampling Protocol & Privacy Guidelines](./wifi/speedtest-sampling.md) — end-to-end telemetry pipeline, payload validation, Redis buffering, Laplace differential privacy, and probe specifications.
- [Venue WiFi Quality Scoring](./venues/WIFI_QUALITY_SCORING.md) — speed tiers, jitter and packet loss penalties, measurement telemetry, and badge display rules.
- [Venue WiFi Spectrum & RF Diagnostics](./venues/WIFI_SPECTRUM_DIAGNOSTICS.md) — frequency band classification (2.4 GHz, 5 GHz, 6 GHz), channel width trade-offs (20/40/80/160 MHz), RSSI/SNR thresholds, co-channel interference detection, and prediction API schema.
- [Venue Power Outlet Standards](./venues/POWER_OUTLET_STANDARDS.md) — outlet density and power type taxonomy, rating aggregation rules, amenity vote verification, and socket telemetry scoring.
- [Voice Search](./features/VOICE_SEARCH.md) — voice search feature documentation.
- [Seating Occupancy Forecasting](./features/seating-occupancy-forecasting.md) — seating occupancy forecasting functionality.
- [Nomad Passport](./features/nomad-passport.md) — Nomad Passport feature and product workflow.
- [Gamification XP & Badge Verification Guide](./badges/GAMIFICATION_XP_GUIDE.md) — XP earning formulas, Night Owl timezone normalization, and WiFi Scout speed test verification criteria.

## Audio & Acoustics

- [WebAssembly SIMD vs Web Audio AnalyserNode Fallback Benchmark Guide](./audio/WASM_SIMD_AUDIO_BENCHMARK.md) — SIMD vectorization, WebAssembly feature detection, AnalyserNode fallback, FFT frequency precision, and benchmark methodology.
- [Opus Audio Tuning & Adaptive Jitter Buffer Reference](./webrtc/OPUS_AUDIO_TUNING.md) — Opus packet-loss concealment (PLC), in-band forward error correction (FEC), WebRTC jitter-buffer telemetry, and WorkSphere's adaptive bitrate step ladder.
- [Ambient Noise Spectrogram Architecture](./audio/NOISE_SPECTROGRAM_ARCHITECTURE.md) — microphone capture, FFT processing, spectrum rendering, waterfall visualization, and audio lifecycle troubleshooting.
- [Acoustic Grading Specification](./audio/ACOUSTIC_GRADING_SPECIFICATION.md) — noise tier boundaries, dB, A-weighting and Leq calculations, Hann-windowed FFT sampling, RT60 reverberation, and crowd-sourced reading guidelines.

## UI Components & Frontend

- [Design System Guide](./DESIGN_SYSTEM_GUIDE.md) — design tokens, themes, components, and frontend styling conventions.
- [Theme Token Architecture](./ui/THEME_TOKEN_ARCHITECTURE.md) — complete CSS variable dictionary, dark mode, Cyberpunk Neon, high-contrast theming, and semantic token migration guide.
- [Fluid Typography and Spacing Guide](./ui/FLUID_TYPOGRAPHY_AND_SPACING.md) — token hierarchy, 4px spacing grid, clamp-based fluid font sizes, WCAG 2.1 AA contrast ratios, and CSS variable reference tables.
- [Accessibility Guide](./ACCESSIBILITY_GUIDE.md) — accessibility standards and implementation guidance.
- [Venue Accessibility Audit Guidelines](./accessibility-audit.md) — step-free access, elevator and restroom audit rubric, how the code scores accessibility, and how to review accessibility reports.
- [Venue Action Glassmorphic Pulse Guide](./ui/GLASSMORPHIC_PULSE_GUIDE.md) — theme-specific venue action button animations, rendering, accessibility, and contrast analysis.
- [Breadcrumb Component](./components/Breadcrumb.md) — breadcrumb component behavior and usage.
- [Floor Plan Viewer 3D](./components/FloorPlanViewer3D.md) — 3D floor-plan viewer documentation.
- [Network Status Pill](./components/NetworkStatusPill.md) — network connectivity status component.

## Offline Support & Realtime Systems

- [Offline Booking Draft State Machine & Conflict Resolution Guide](./pwa/OFFLINE_BOOKING_DRAFTS.md) — IndexedDB draft persistence, vector clock causal sync, CRDT field resolution, and Service Worker background synchronization.
- [PWA Service Worker Caching Strategy & Invalidation Runbook](./pwa/SERVICE_WORKER_CACHING_STRATEGY.md) — Progressive Web App service worker caching tiers, Workbox strategies, deployment versioning, background sync queues, and storage quota management.
- [IndexedDB Offline Sync Architecture](./offline/indexeddb-sync-architecture.md) — offline mutations, IndexedDB storage, and synchronization.
- [Dead Letter Queue](./offline/dead-letter-queue.md) — handling and recovery of failed offline jobs.
- [Offline Sync Flow](./architecture/offline-sync-flow.md) — application offline synchronization flow.
- [Local Mesh CRDT Synchronization](./realtime/local-mesh-crdt-sync.md) — collaborative state replication over peer-to-peer mesh connections.
- [PartyKit WebSocket Room Heartbeat & Reconnection Protocol](./realtime/PARTYKIT_RECONNECTION_PROTOCOL.md) — 30s ping/pong heartbeats, randomized exponential jitter backoff, and room state reconciliation.
- [CRDT Documentation Index](./crdt/README.md) — collaborative data protocols, specifications, and reading order.
- [Yjs State Vector Exchange & Differential Compaction Architecture](./crdt/YJS_SYNC_PROTOCOL.md) — complete Yjs state vector exchange (`Y.encodeStateVector`), differential update computation (`Y.encodeStateAsUpdate`), wire codecs, and snapshot compaction engine.
- [Ephemeral Awareness Vector Clock Compaction](./crdt/AWARENESS_VECTOR_COMPACTION.md) — ephemeral presence tracking, 30s TTL heartbeat eviction, and awareness vector compaction vs. document-level garbage collection.

## Testing, Monitoring & Operations

- [Playwright Testing Guide](./testing/PLAYWRIGHT_GUIDE.md) — end-to-end testing for booking workflows.
- [End-to-End Playwright Guide](./testing/e2e-playwright.md) — browser-based end-to-end testing documentation.
- [Playwright PWA Offline Testing Runbook](./testing/PLAYWRIGHT_OFFLINE_TESTING.md) — network emulation (`context.setOffline`), IndexedDB draft inspection, and Service Worker cache verification.
- [Core Web Vitals Token-Bucket Reporting Specification](./telemetry/CORE_WEB_VITALS_SPEC.md) — client-side metric collection, cookie consent requirements, deterministic session sampling, payload schema, and 120 req/min token-bucket rate limiting.
- [Web Vitals Guide](./telemetry/web-vitals-guide.md) — Core Web Vitals thresholds and performance telemetry.
- [Vitals Export Pipeline](./telemetry/vitals-export-pipeline.md) — telemetry export and operational pipeline.
- [Route Latency Heatmap Architecture](./admin/ROUTE_LATENCY_HEATMAP.md) — route telemetry collection, bucket aggregation, percentiles, API contract, and canvas rendering limitations.
- [WebGPU Fallback Triage Runbook](./runbooks/WEBGPU_FALLBACK_TRIAGE.md) — diagnosing WebGPU device loss and fallback behavior.
- [Reservation CDC Operations](./workers/RESERVATION_CDC_OPERATIONS.md) — PostgreSQL logical replication and Redis Stream operations.
- [Troubleshooting](./TROUBLESHOOTING.md) — common development and operational troubleshooting guidance.
- [WebGPU Capability Diagnostics](./telemetry/WEBGPU_CAPABILITY_DIAGNOSTICS.md) — capability report schema, privacy controls, API submission, and administrator troubleshooting.

## Analytics & Sustainability

- [Commuter Carbon Savings Guide](./analytics/CARBON_SAVINGS_GUIDE.md) — emission factor baselines, avoided-emissions formulas, transit mode differentials, date range presets, and CSV and team badge SVG exports.
- [Carbon Calculation Methodology](./analytics/CARBON_CALCULATION_METHODOLOGY.md) — mode calculator constants, formulas and properties, a step-by-step transit comparison, and how the factor tables differ.
- [Venue Carbon Footprint Methodology](./analytics/carbon-methodology.md) — venue energy against baseline, kWh and emissions formulas with an 8-hour sample, grid factor guidance, eco badge rules, and how to add telemetry signals.
- [GHG Scope 3 Methodology](./sustainability/ghg-scope-3-methodology.md) — GHG Protocol Scope 3 framing, carbon engine implementation, and ESG audit CSV contract.

## Export & Reporting

- [CSV and Excel Export Architecture Developer Guide](./export/CSV_EXCEL_EXPORT_GUIDE.md) — Comprehensive developer reference for typed CSV and Excel XML export builders, RFC-4180 escaping, formula injection sanitization, and browser download handling.
- [Booking Itinerary & PDF Verification System](./export/booking-pdf-generation.md) — Specification and architecture for booking receipts, vector QR matrix generation, and cryptographic verification seals.
- [Nomad Attendance Certificate Cryptographic Verification Flow](./certificates/NOMAD_CERTIFICATE_VERIFICATION.md) — End-to-end nomad stay certificate lifecycle, pdf-lib vector layout, HMAC-SHA256 tamper-evident payload, and public verification API.

## UI Components & Frontend

- [NotificationBell Component Guide](./NOTIFICATION_BELL_GUIDE.md) — Top navigation notification bell, live polling, optimistic mark-as-read, undo restoration, and backend API contract.
- [Bounded Texture Cache LRU Eviction & WebGL Lifecycle](./webgl/BOUNDED_TEXTURE_CACHE.md) — Bounded WebGL texture cache, LRU eviction policies, 64MB memory budgets, and WebGL context restoration handling.
