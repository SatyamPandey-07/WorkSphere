# Digital Nomad Tax Compliance & Zero-Knowledge Presence Engine Integration Guide

**Document ID:** `WS-GUIDE-TAX-007`  
**Owner:** FinTech, Geospatial & Cryptography Engineering  
**Applies To:** `/analytics/nomad-tax`, `/api/tax/nomad-compliance`, `/api/bookings/export`, `src/lib/tax/*`, `circuits/presence_verifier.circom`  

---

## 1. Overview & Architecture

WorkSphere's **Digital Nomad Tax Compliance Engine** continuously evaluates physical presence across tax jurisdictions using privacy-preserving client geo-fencing, verified coworking check-ins, and Groth16 zero-knowledge proofs (zk-SNARKs). It enables remote professionals and distributed teams to monitor statutory day-count thresholds, generate audit-ready expense/residency ledgers (`JSON` and `CSV`), and cryptographically prove non-residency or physical presence without exposing raw GPS coordinates.

```text
┌───────────────────────────────────────────────────────────────────────────┐
│                      CLIENT DEVICE (EDGE GEO-FENCE)                       │
│                                                                           │
│  GPS / Wi-Fi BSSID / Verified Venue Check-In                              │
│         │                                                                 │
│         ▼                                                                 │
│  1. Polygon Point-in-Jurisdiction Lookup (ISO 3166-1 alpha-2 / Sub-region)│
│  2. Transition Detector ──► Emits BorderCrossingEvent (signed & hashed)   │
│  3. Optional ZK Prover  ──► Generates Groth16 Proof over quantized lat/lon│
└────────────────────────────────────┬──────────────────────────────────────┘
                                     │ HTTPS POST /api/tax/nomad-compliance
                                     ▼
┌───────────────────────────────────────────────────────────────────────────┐
│                     TAX COMPLIANCE & LEDGER ENGINE                        │
│                                                                           │
│  • Jurisdiction Rule Registry (Calendar Year, Rolling 12-Mo, Weighted SPT)│
│  • Midnight vs. Any-Part-of-Day Attribution & Transit Exemption Filter    │
│  • Threshold Alerting (75% Amber Warning, 90% Critical, >= 183 Trigger)   │
│  • Audit Exporter (/api/bookings/export?format=json|csv)                  │
└───────────────────────────────────────────────────────────────────────────┘