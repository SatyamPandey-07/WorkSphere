# DTN Bundle Ingestion & Fragment Recovery Architecture

Documents priority tiers, queue ordering rules, partial-bundle TTL eviction, and memory bounds for DTN bundle ingestion and fragment recovery.

## 1. Priority Tiers & Ordering Rules

* **Tiers:** `CRITICAL` (highest), `NORMAL`, and `BULK` (lowest).
* **Ordering:** Sort by priority tier first, then earliest `expiresAtMs`, then deterministic arrival sequence / bundle ID tie-breaker.

## 2. Partial-Bundle TTL Eviction & Memory Bounds

* **Partial TTL Eviction:** Evict incomplete fragment sets once `partialTtlMs` or bundle `expiresAtMs` elapses, recording eviction counts.
* **Memory Bounds:** Cap reassembly buffer bytes (`maxReassemblyBytes`), concurrent partial bundles (`maxPartialBundles`), and queue bytes; evict expired or lowest-priority partial entries first under memory pressure.
