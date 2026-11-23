# Hybrid Logical Clocks and Vector Clocks in WorkSphere

## 1. Motivation: NTP Drift vs. Pure Lamport Timestamps in a Nomad Mesh

WorkSphere coordinates concurrent whiteboard operations and group chat messages across multi-datacenter deployments, browser/mobile clients, and intermittently connected peer-to-peer (P2P) WebRTC swarms (a "nomad mesh"). Relying on a single ordering mechanism breaks down under real-world network and hardware conditions:

* **Physical clocks and NTP skew:** Wall-clock time synchronized via Network Time Protocol (NTP) has bounded error $\vert{}T_{\text{ref}} - T_{\text{node}}\vert{} \le \epsilon$, which widens when peers traverse NATs, go offline, or experience asymmetric routing and step/slew adjustments. Two concurrent whiteboard strokes on separate peers can carry inverted physical timestamps, violating causality or overwriting a causally later edit under naive last-writer-wins rules.
* **Pure Lamport logical clocks:** Lamport timestamps capture one-way causality ($e \to f \implies L(e) < L(f)$) without depending on wall-clock accuracy, but they lose real-time proximity and cannot distinguish causal order from concurrency ($L(e) < L(f)$ does not imply $e \to f$, and $L(e) = L(f)$ does not imply $e \parallel f$). They also provide no bound against a drifting or offline peer jumping arbitrarily far ahead or behind physical time.
* **Why WorkSphere pairs HLC with Vector Clocks:** Hybrid Logical Clocks (HLC) keep timestamps anchored close to physical time with constant $O(1)$ space overhead while preserving causal ordering ($e \to f \implies \text{HLC}(e) < \text{HLC}(f)$). Vector Clocks complement HLC for explicit concurrency detection ($e \parallel f \iff \text{VC}(e) \not\le \text{VC}(f) \land \text{VC}(f) \not\le \text{VC}(e)$) and causal dependency tracking across P2P WebRTC channels before rendering or compacting state.

---

## 2. HLC Tuple Structure $(l, c)$ and Bounded Drift

Each peer maintains an HLC state tuple $(l, c)$ alongside its local monotonic/wall clock reading $pt$:

* **$l$ (Logical / Max Physical Component):** Tracks the maximum physical timestamp observed so far across local physical time and remote HLC timestamps received over WebRTC or sync relays. When a peer receives a message with a much higher $l_{\text{msg}}$, adopting $\max(pt, l, l_{\text{msg}})$ advances $l$ forward so causal order is preserved even if the local clock lags.
* **$c$ (Logical Counter):** Breaks ties when multiple events share the same physical component $l$—such as rapid local whiteboard pointer events within the same millisecond or events from peers whose $l$ values equalize. $c$ resets to `0` whenever $l$ strictly advances to a new physical timestamp and increments by `1` otherwise.
* **Drift bound ($\Delta_{\max}$):** Because $l$ can advance ahead of $pt$ after receiving a timestamp from a peer with a fast clock or stale offline jump, WorkSphere enforces a maximum drift bound $\Delta_{\max}$ (e.g., `l - pt <= MAX_DRIFT_MS`). If an incoming message's physical component exceeds $pt + \Delta_{\max}$, the sync layer flags or rejects/clamps the skew rather than allowing an unbounded clock jump to starve future updates.

### Clock Drift and Bounded Skew State Diagram

```text
  Local Event / Send                 Receive Remote (l_r, c_r)
         │                                       │
         ▼                                       ▼
  Read pt = now_ms()                    Read pt = now_ms()
         │                                       │
         ▼                                       ▼
  l' = max(l, pt)                 Check |l_r - pt| vs MAX_DRIFT_MS
         │                                       │
         ├── l' == l ──► c' = c + 1              ├── Within bound ──► l' = max(l, l_r, pt)
         └── l' >  l ──► c' = 0                        │
                                                 ├── l' == l and l' == l_r ──► c' = max(c, c_r) + 1
                                                 ├── l' == l and l' >  l_r ──► c' = c + 1
                                                 ├── l' == l and l' <  l_r ──► c' = c_r + 1
                                                 └── l' >  l               ──► c' = 0
                                                 │
                                                 └── Exceeds MAX_DRIFT_MS ──► Quarantine / reject skew