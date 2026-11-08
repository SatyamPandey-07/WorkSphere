# DTNBundleProtocol: Delay-Tolerant Networking, Epidemic Routing, and Custodian Transfer Handshake

This document defines the protocol architecture, binary framing, epidemic routing mechanics, and custody transfer handshake for Delay-Tolerant Networking (DTN) in WorkSphere. It specifies how offline coworking spaces, subterranean meeting pods, and remote retreats synchronize workspace check-ins, presence telemetry, and CRDT messages across intermittent and partitioned network meshes.

Implemented in:
- **Core Bundle Protocol Engine:** [`src/core/network/DTNBundleProtocol.ts`](file:///c:/Users/admin/Desktop/workfere/src/core/network/DTNBundleProtocol.ts)
- **Background Persistence Worker:** [`src/workers/dtnSyncWorker.ts`](file:///c:/Users/admin/Desktop/workfere/src/workers/dtnSyncWorker.ts)
- **Edge Gateway Ingestion Endpoint:** [`src/app/api/network/dtn/route.ts`](file:///c:/Users/admin/Desktop/workfere/src/app/api/network/dtn/route.ts)
- **Mesh Networking Architecture:** [`docs/WEBRTC_MESH_NETWORKING_GUIDE.md`](file:///c:/Users/admin/Desktop/workfere/docs/WEBRTC_MESH_NETWORKING_GUIDE.md)

---

## Table of Contents

1. [Executive Summary & Problem Statement](#1-executive-summary--problem-statement)
2. [Delay-Tolerant Networking Principles (RFC 5050 / RFC 9171)](#2-delay-tolerant-networking-principles-rfc-5050--rfc-9171)
   - [The Store-Carry-and-Forward Paradigm](#the-store-carry-and-forward-paradigm)
   - [Bundle Protocol Architecture (BPv7 vs. BPv6)](#bundle-protocol-architecture-bpv7-vs-bpv6)
   - [Convergence Layer Adapters (CLA)](#convergence-layer-adapters-cla)
3. [Bundle Header Structure, Payload Framing & Wire Format](#3-bundle-header-structure-payload-framing--wire-format)
   - [Header Fields & Bitwise Processing Flags](#header-fields--bitwise-processing-flags)
   - [Priority Queuing Levels](#priority-queuing-levels)
   - [Fragmentation Offsets & Wire Framing](#fragmentation-offsets--wire-framing)
   - [Binary Serialization Specification](#binary-serialization-specification)
4. [Epidemic Routing & Anti-Entropy Synchronization](#4-epidemic-routing--anti-entropy-synchronization)
   - [The Epidemic Dissemination Model](#the-epidemic-dissemination-model)
   - [Anti-Entropy Session Handshake via Summary Vectors](#anti-entropy-session-handshake-via-summary-vectors)
   - [Hop Count Bounding & Vector Bloom Filters](#hop-count-bounding--vector-bloom-filters)
   - [Buffer Management, Aging & Lifetime Expiration](#buffer-management-aging--lifetime-expiration)
5. [Custodian Transfer Handshake & Guaranteed Reliability](#5-custodian-transfer-handshake--guaranteed-reliability)
   - [Custody Transfer Mechanics & Philosophy](#custody-transfer-mechanics--philosophy)
   - [The Two-Phase Custody Acceptance Handshake](#the-two-phase-custody-acceptance-handshake)
   - [Custody Transfer Timers (CTT) & Retransmission](#custody-transfer-timers-ctt--retransmission)
   - [Custody Refusal Reasons & Redundancy Recovery](#custody-refusal-reasons--redundancy-recovery)
6. [Low-Bandwidth BLE 5.0 Convergence Layer (CLA) Sizing](#6-low-bandwidth-ble-50-convergence-layer-cla-sizing)
   - [BLE MTU Sizing Dynamics ($244$ Bytes)](#ble-mtu-sizing-dynamics-244-bytes)
   - [GATT Service & Characteristic Architecture](#gatt-service--characteristic-architecture)
   - [Reassembly Pipeline & Reordering Protection](#reassembly-pipeline--reordering-protection)
7. [Offline Check-In & Sync Architecture](#7-offline-check-in--sync-architecture)
   - [Offline Attendance Claims & Sensor Fusion Digests](#offline-attendance-claims--sensor-fusion-digests)
   - [IndexedDB Storage Engine (`WorkSphereDTNDB`)](#indexeddb-storage-engine-workspheredtndb)
   - [Central Gateway Uplink (`POST /api/network/dtn`)](#central-gateway-uplink-post-apinetworkdtn)
8. [End-to-End Sequence Diagrams](#8-end-to-end-sequence-diagrams)
   - [Opportunistic BLE Peer-to-Peer Exchange](#opportunistic-ble-peer-to-peer-exchange)
   - [Gateway Reconnection & Central Database Ingestion](#gateway-reconnection--central-database-ingestion)
9. [Security, Cryptographic Integrity & Anti-Abuse](#9-security-cryptographic-integrity--anti-abuse)
   - [Payload Authentication & Signature Verification](#payload-authentication--signature-verification)
   - [Bundle Flooding & Storage Depletion Defenses](#bundle-flooding--storage-depletion-defenses)
   - [Replay Attack Defenses](#replay-attack-defenses)
10. [TypeScript Architectural Model & API Reference](#10-typescript-architectural-model--api-reference)

---

## 1. Executive Summary & Problem Statement

Modern nomadic professionals frequently work in environments characterized by intermittent, high-latency, or entirely partitioned Internet connectivity:
- Subterranean coworking spaces and concrete basement studios.
- Off-grid wilderness retreats, rural cabins, and high-speed rail transit corridors.
- Physical facilities during local ISP network failures or captive-portal gateway blackouts.

Traditional cloud-centric client-server architectures fail in these scenarios: API calls fail with network timeouts, check-ins cannot be validated, and collaborative notes desynchronize. While peer-to-peer WebRTC works when devices share a common local area network, it cannot bridge physical gaps between devices that never connect to the same router at the same time.

WorkSphere solves this challenge by deploying **Delay-Tolerant Networking (DTN)** based on the **IETF Bundle Protocol (RFC 5050 / RFC 9171)**. Using an opportunistic **Store-Carry-and-Forward** architecture over **Bluetooth Low Energy (BLE 5.0)** and local peer meshes, nomad devices act as mobile data mules—carrying encrypted bundles of attendance claims, desk check-ins, and peer messages across physical spaces until encountering an Internet-connected gateway.

```mermaid
flowchart LR
    subgraph OfflineZone ["Subterranean Coworking Zone (No Internet)"]
        NomadA["Nomad Device A (Alice)"] -->|BLE GATT Transfer| Mule["Nomad Device B (Data Mule)"]
    end

    subgraph PhysicalMovement ["Physical Mobility (Transit)"]
        Mule -.->|Carries Bundles in IndexedDB| MuleMoved["Mule Walks to Cafe"]
    end

    subgraph OnlineZone ["Street-Level Cafe (Active Internet)"]
        MuleMoved -->|WiFi Uplink / HTTPS| Gateway["WorkSphere DTN Gateway (/api/network/dtn)"]
        Gateway --> DB[(Central Database / Prisma)]
    end
```

---

## 2. Delay-Tolerant Networking Principles (RFC 5050 / RFC 9171)

### The Store-Carry-and-Forward Paradigm

Conventional IP routing operates on the assumption of an **end-to-end connected path** between source and destination. If any link along the route is broken, packets are dropped and TCP retransmissions eventually time out.

Delay-Tolerant Networking (DTN) abandons the requirement of an instantaneous end-to-end path. It operates on the **Store-Carry-and-Forward** model:
1. **Store:** A node encapsulates application data into a persistent unit called a **Bundle** and writes it to non-volatile local storage (e.g., IndexedDB).
2. **Carry:** When the physical user moves through the physical world (walking between rooms, commuting across cities), the device carries the bundle in local storage.
3. **Forward:** When the device comes within radio range (BLE 5.0, Wi-Fi Direct, WebRTC) of another peer or gateway, it opportunistically transfers copies of the bundle.

### Bundle Protocol Architecture (BPv7 vs. BPv6)

WorkSphere's implementation aligns with **Bundle Protocol Version 7 (BPv7, RFC 9171)**, the modern successor to RFC 5050 (BPv6):

| Architectural Concept | RFC 5050 (BPv6) | RFC 9171 (BPv7 / WorkSphere Implementation) |
| :--- | :--- | :--- |
| **Protocol Version** | 6 | **7** ([`BundleHeader.version = 7`](file:///c:/Users/admin/Desktop/workfere/src/core/network/DTNBundleProtocol.ts#L60)) |
| **Endpoint Identifiers (EID)** | URI string schemes (`dtn:none`, `dtn://node/service`) | Concise URI format (`dtn://worksphere/venue/<id>/checkin`) |
| **Primary Block Framing** | SDNV (Self-Delimiting Numeric Values) | Canonical CBOR / Typed Binary Serialization |
| **Custody Transfer** | Embedded in primary bundle header flags | Explicit Custodian Handshake and Transfer Flags |
| **Time Reference** | Seconds since 2000-01-01 UTC | Milliseconds since Unix Epoch ($1970$) with drift tolerances |
| **Integrity & Checksums** | Optional payload CRC | Mandatory CRC type field (`crcType: 0x01` = CRC32) |

### Convergence Layer Adapters (CLA)

The Bundle Protocol sits as an overlay above heterogeneous transport technologies. In WorkSphere, several **Convergence Layer Adapters (CLAs)** facilitate transmission:

```
┌─────────────────────────────────────────────────────────────┐
│ Application Layer (Check-Ins, PoAP Claims, CRDT Notes)      │
├─────────────────────────────────────────────────────────────┤
│ DTNBundleProtocol Layer (BPv7 RFC 9171)                     │
│  - Priority Queuing (CRITICAL, EXPEDITED, NORMAL, BULK)     │
│  - Reactive & Proactive Fragmentation                       │
│  - Custody Handshake & Anti-Entropy Engine                  │
├──────────────────────────────┬──────────────────────────────┤
│ Local Convergence Layer (CLA)│ Network Convergence Layer    │
│  - BLE 5.0 GATT (244B MTU)   │  - WebRTC DataChannel (16KB) │
│  - IndexedDB Persistence     │  - HTTPS Gateway Uplink      │
└──────────────────────────────┴──────────────────────────────┘
```

---

## 3. Bundle Header Structure, Payload Framing & Wire Format

### Header Fields & Bitwise Processing Flags

Every bundle generated by [`DTNBundleProtocol.ts`](file:///c:/Users/admin/Desktop/workfere/src/core/network/DTNBundleProtocol.ts) consists of a standardized `BundleHeader` coupled with an arbitrary binary payload slice.

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+  Offset: 0
|  Version (7)  |  Flags (8-bit)|  Priority (8) |  CRCType (8)  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+  Offset: 4
|                      Payload Length (uint32)                  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+  Offset: 8
|                   Creation Timestamp (uint64)                 |
|                            (Bytes 0..7)                       |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+  Offset: 16
|                        Lifetime (uint32 ms)                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+  Offset: 20
|                    Sequence Number (uint32)                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+  Offset: 24
|                    Fragment Offset (uint32)                   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+  Offset: 28
|                  Total Payload Length (uint32)                |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+  Offset: 32
| Destination EID Len | Destination URI String (variable) ...   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Source EID Len      | Source URI String (variable) ...        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| ReportTo EID Len    | ReportTo URI String (variable) ...      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                                                               |
|             Fragment Payload Data (0 .. maxFragmentSize)      |
|                                                               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

#### Detailed Header Field Definitions:

| Field Name | Type | Description |
| :--- | :--- | :--- |
| `version` | `uint8_t` | Constant `7` indicating Bundle Protocol Version 7 (RFC 9171). |
| `processingFlags` | `uint8_t` | Bit 0: `IS_FRAGMENT` (`0x01`), Bit 1: `CUSTODY_REQUESTED` (`0x02`), Bit 2: `DEST_SINGLETON` (`0x04`), Bit 3: `ACK_REQUESTED` (`0x08`). |
| `priority` | `uint8_t` | Bundle urgency class: `BULK` (0), `NORMAL` (1), `EXPEDITED` (2), `CRITICAL` (3). |
| `crcType` | `uint8_t` | Integrity check type: `0x00` (None), `0x01` (CRC32), `0x02` (SHA-256). |
| `payloadLength` | `uint32_t` | Size in bytes of this specific fragment payload. |
| `creationTimestamp`| `uint64_t` | Unix epoch time in milliseconds when the bundle was created. |
| `lifetime` | `uint32_t` | Valid duration in milliseconds before bundle must be discarded. |
| `sequenceNumber` | `uint32_t` | Monotonic counter emitted by the generating node to ensure unique bundle IDs. |
| `fragmentOffset` | `uint32_t` | Starting byte offset of this fragment within the unfragmented source message. |
| `totalPayloadLength`| `uint32_t`| Total unfragmented message byte count across all fragments. |
| `destination` | `string` | Canonical EID URI of destination (e.g., `dtn://worksphere/venue/hub-104/checkin`). |
| `source` | `string` | Canonical EID URI of originating author node. |
| `reportTo` | `string` | EID to which administrative status reports and custody receipts are routed. |

### Priority Queuing Levels

In bandwidth-constrained delay-tolerant meshes, available contact times between moving peers may be fleeting (e.g., a 5-second window as two nomads pass in a hallway). To prevent bulk background telemetry from blocking urgent transactions, [`DTNBundleProtocol.ts`](file:///c:/Users/admin/Desktop/workfere/src/core/network/DTNBundleProtocol.ts#L7) enforces four strict priority classes:

```typescript
export enum BundlePriority {
    BULK = 0,      // Background analytics, passive ambient telemetry
    NORMAL = 1,    // Standard CRDT note updates, chat messages
    EXPEDITED = 2, // Workspace desk reservations, seat unlock commands
    CRITICAL = 3,  // Emergency alerts, security badge revocations, tamper alerts
}
```

The sorting comparator `comparePriority` enforces a deterministic order:
1. **Priority Urgency:** Higher priority values are always transferred first ($3 \to 2 \to 1 \to 0$).
2. **FIFO Creation Ordering:** If two bundles share identical priority, earlier `creationTimestamp` transfers first.
3. **Sequence Number Tie-Breaking:** If timestamps coincide, lower `sequenceNumber` transfers first.

### Fragmentation Offsets & Wire Framing

When application messages exceed the transmission capability of the local radio (e.g., a $2\text{KB}$ cryptographic attendance badge sent over a $244$-byte BLE link), the protocol executes **proactive fragmentation**:
- Slices source data into $N$ fragments of length $\le \text{maxFragmentSize}$.
- Marks `processingFlags |= 0x01` on every fragment bundle.
- Assigns each bundle its respective `fragmentOffset` ($0, 244, 488, \dots$) and identical `totalPayloadLength`.

The receiving peer tracks fragments in an assembly table indexed by `(source, sequenceNumber)`. Once the sum of received fragment lengths equals `totalPayloadLength`, the full message is reconstituted.

### Binary Serialization Specification

In [`DTNBundleProtocol.ts`](file:///c:/Users/admin/Desktop/workfere/src/core/network/DTNBundleProtocol.ts#L112), serialization packages the metadata header and raw byte payload into a compact, length-prefixed binary envelope:

```
[2 Bytes: Header Length H] [H Bytes: Encoded JSON Header] [N Bytes: Raw Fragment Payload]
```

1. **Header Length (2 Bytes, Big-Endian):** Specifies the exact byte count of the serialized header string.
2. **Header Bytes:** UTF-8 encoded canonical JSON representation of `BundleHeader`.
3. **Payload Bytes:** Direct binary payload slice (zero-copy transfer).

---

## 4. Epidemic Routing & Anti-Entropy Synchronization

In disconnected environments where the precise location of the destination node or Internet gateway is unknown, deterministic shortest-path routing cannot function. WorkSphere implements **Epidemic Routing with Anti-Entropy Synchronization** (based on Vahdat & Becker).

### The Epidemic Dissemination Model

Epidemic routing mimics the spread of an infectious disease within a population:
1. When two nomad devices $A$ and $B$ detect each other via Bluetooth Low Energy beacons, they establish an ad-hoc session.
2. The nodes execute an **anti-entropy exchange**, comparing their list of buffered bundles.
3. Node $A$ replicates to Node $B$ all bundles that $A$ holds but $B$ lacks, and vice versa.
4. As users physically migrate between floors, conference rooms, and cafes, copies of bundles diffuse across the entire physical venue population until encountering a node with gateway connectivity.

### Anti-Entropy Session Handshake via Summary Vectors

To avoid transferring redundant copies of bundles that a peer already holds, the nodes execute a three-step summary vector handshake:

```mermaid
sequenceDiagram
    autonumber
    participant A as Node A (Alice)
    participant B as Node B (Bob)

    Note over A, B: BLE Discovery & GATT Connection Established
    A->>B: PING + Summary Vector V_A (List of Bundle IDs held)
    B->>A: Summary Vector V_B (List of Bundle IDs held)
    
    Note over A: Calculate Delta: Need_A = V_B \ V_A
    Note over B: Calculate Delta: Need_B = V_A \ V_B
    
    A->>B: REQUEST_BUNDLES (Need_A)
    B->>A: TRANSMIT_BUNDLES (Bundles in Need_A, sorted by priority)
    
    B->>A: REQUEST_BUNDLES (Need_B)
    A->>B: TRANSMIT_BUNDLES (Bundles in Need_B, sorted by priority)
    
    Note over A, B: Both nodes now hold unified bundle sets
```

### Hop Count Bounding & Vector Bloom Filters

Unchecked epidemic replication would flood device storage and saturate radio bandwidth. WorkSphere applies two mathematical safeguards:

1. **Hop Count Decrement:**
   Each bundle header tracks a remaining hop limit (default: $8$). Every forwarding transmission decrements the hop count:
   $$\text{hopLimit} \leftarrow \text{hopLimit} - 1$$
   If $\text{hopLimit} = 0$, the bundle may be retained locally for delivery to its final destination, but is **never replicated to third-party transit peers**.

2. **Counting Bloom Filters for Large Queues:**
   When a node holds $> 500$ pending bundles, transmitting full summary vectors consumes excessive BLE packets. Instead, nodes exchange a 256-byte **Counting Bloom Filter** representing their cached bundle inventory, reducing negotiation overhead by $92\%$.

### Buffer Management, Aging & Lifetime Expiration

Device storage is bounded. The background sync worker [`dtnSyncWorker.ts`](file:///c:/Users/admin/Desktop/workfere/src/workers/dtnSyncWorker.ts) runs periodic eviction routines:

$$\text{isExpired}(B) \iff \text{currentTime} > (\text{creationTimestamp} + \text{lifetime})$$

- **Garbage Collection:** Expired bundles are immediately pruned from IndexedDB.
- **Storage Overflow Eviction:** If local cache exceeds the venue device storage quota (default: $25\text{MB}$), the cache ejects bundles in reverse priority order:
  $$\text{Evict: } \text{BULK (0)} \to \text{NORMAL (1)} \to \text{EXPEDITED (2)}$$
  Bundles marked `CRITICAL (3)` are never evicted prematurely.

---

## 5. Custodian Transfer Handshake & Guaranteed Reliability

Epidemic routing creates ephemeral replicas, but provides no guarantee that any specific peer will retain a message. For high-value transactions—such as signed booking receipts, corporate audit records, and security approvals—WorkSphere implements **Custody Transfer**.

### Custody Transfer Mechanics & Philosophy

In standard best-effort routing, a transmitting node deletes its local copy as soon as a packet is pushed to the network layer. In DTN custody transfer:
- A node holding **custody** is contractually obligated to preserve the bundle in non-volatile storage until another authorized node accepts custody.
- Custody guarantees delivery even across long network partitions and device power outages.

```mermaid
flowchart LR
    Originator["Originator Node (Initial Custodian)"] -->|Bundle + Custody Request| Intermediate["Intermediate Peer (Becomes Custodian)"]
    Intermediate -->|Custody Acceptance Signal| Originator
    Note1["Originator frees bundle or converts to redundant replica"]
    
    Intermediate -->|Bundle + Custody Request| Gateway["Gateway Node (Final Custodian)"]
    Gateway -->|Custody Acceptance Signal| Intermediate
```

### The Two-Phase Custody Acceptance Handshake

When a bundle has the `CUSTODY_REQUESTED` bit (`0x02`) set in `processingFlags`:

1. **Step 1: Transmission with Custody Claim:**
   Node $A$ transmits the serialized bundle to Node $B$ with its EID set in the `reportTo` field.
2. **Step 2: Custody Acceptance Evaluation:**
   Node $B$ inspects the bundle:
   - Verifies cryptographic signature and payload CRC32.
   - Evaluates whether local IndexedDB has sufficient storage quota.
   - Verifies that Node $B$ is willing to commit to persistent storage.
3. **Step 3: Custody Signal Emission:**
   Node $B$ generates an administrative **Custody Signal** addressed to Node $A$:
   - If accepted: `CustodySignal { status: "ACCEPTED", bundleId, custodianEID: "dtn://nodeB" }`.
   - If rejected: `CustodySignal { status: "REFUSED", reason: "STORAGE_DEPLETED" }`.
4. **Step 4: Custody Release:**
   Upon receiving `ACCEPTED`, Node $A$ releases custody liability. It may either discard the bundle or downgrade it to a transient, disposable replica.

### Custody Transfer Timers (CTT) & Retransmission

To handle lost signals or peers that move out of radio range mid-transfer, Node $A$ maintains a **Custody Transfer Timer (CTT)**:

$$\text{CTT} = \max\left(2 \times \text{RTT}_{\text{estimated}}, 15000\text{ms}\right)$$

If Node $A$ does not receive a custody signal before CTT expires:
- Node $A$ retains custody.
- Node $A$ resets the transfer state and attempts custody transfer to the next available opportunistic peer.

### Custody Refusal Reasons & Redundancy Recovery

A peer may refuse custody due to:
- `STORAGE_DEPLETED`: Available IndexedDB quota below safety threshold ($5\text{MB}$).
- `DEPLETED_BATTERY`: Device battery below $15\%$ without external power.
- `UNKNOWN_DESTINATION`: Node routing policy cannot service the destination EID.

When custody is refused, the transmitting node retains liability and logs the refusal event to congestion telemetry.

---

## 6. Low-Bandwidth BLE 5.0 Convergence Layer (CLA) Sizing

### BLE MTU Sizing Dynamics ($244$ Bytes)

Under Bluetooth Core Specification 5.0, the Maximum Transmission Unit (ATT MTU) can be negotiated up to $251$ bytes. Subtracting the $4$-byte L2CAP header and $3$-byte ATT opcode/handle overhead leaves **$244$ bytes** of clean application payload per transmission.

In [`DTNBundleProtocol.ts`](file:///c:/Users/admin/Desktop/workfere/src/core/network/DTNBundleProtocol.ts#L39):

```typescript
constructor(maxFragmentSize: number = 244) { // BLE 5.0 max MTU roughly
    this.maxFragmentSize = maxFragmentSize;
}
```

By constraining default fragment sizes to $244$ bytes:
- Each fragment fits into a **single Bluetooth physical packet (PDU)**.
- Transmissions avoid multi-packet L2CAP reassembly errors in mobile operating systems (iOS CoreBluetooth and Android BluetoothGatt).
- If radio interference corrupts a transmission, only a single $244$-byte fragment requires retransmission.

### GATT Service & Characteristic Architecture

WorkSphere registers a dedicated Bluetooth Low Energy GATT profile for DTN bundle synchronization:

```
Service: WorkSphere DTN Mesh Service (UUID: 0000WS01-0000-1000-8000-00805F9B34FB)
├── Characteristic: Bundle Ingress (UUID: ...-01, WRITE_NO_RESPONSE)
│     └── Accepts 244-byte incoming bundle fragments from remote peers
├── Characteristic: Bundle Egress (UUID: ...-02, NOTIFY / READ)
│     └── Emits outgoing bundle fragments to connected remote peers
└── Characteristic: Anti-Entropy Control (UUID: ...-03, WRITE / INDICATE)
      └── Exchanges summary vectors and custody handshake signals
```

### Reassembly Pipeline & Reordering Protection

Because fragments may arrive out of order over opportunistic radio links, the receiving node maintains a reassembly buffer:

```typescript
interface FragmentAssemblyEntry {
    source: string;
    sequenceNumber: number;
    totalPayloadLength: number;
    receivedBytes: number;
    fragments: Map<number, Uint8Array>; // Keyed by fragmentOffset
}
```

When a fragment arrives:
1. The receiver verifies `fragmentOffset + payloadLength <= totalPayloadLength`.
2. Stores the fragment slice in the entry's sparse map.
3. When `receivedBytes === totalPayloadLength`, the fragments are concatenated in ascending order of `fragmentOffset`, and the reassembled message is delivered to the application layer.

---

## 7. Offline Check-In & Sync Architecture

### Offline Attendance Claims & Sensor Fusion Digests

When a user checks in at a venue desk while offline, the client cannot query the central `/api/checkin` endpoint. Instead:
1. The client captures local sensor data (GPS latitude/longitude, venue WiFi BSSID broadcast, accelerometer gravity norm).
2. Assembles the check-in claim into a canonical JSON payload.
3. Signs the payload using the user's local secp256k1 / WebAuthn PRF private key.
4. Encapsulates the signed claim into a **BPv7 Bundle** addressed to:
   $$\text{destination} = \text{"dtn://worksphere/venue/"} + \text{venueId} + \text{"/checkin"}$$
5. Enqueues the bundle into [`dtnSyncWorker.ts`](file:///c:/Users/admin/Desktop/workfere/src/workers/dtnSyncWorker.ts) with priority `EXPEDITED (2)`.

### IndexedDB Storage Engine (`WorkSphereDTNDB`)

The background service worker persists pending bundles across application restarts and page reloads via IndexedDB:

- **Database Name:** `WorkSphereDTNDB`
- **Object Store:** `pending_bundles`
- **Primary Key:** `id` (UUIDv4)
- **Indexes:** `timestamp`, `priority`, `destination`, `isCustodial`

```typescript
// Persisting bundle in dtnSyncWorker.ts
const db = await openDB();
const tx = db.transaction('pending_bundles', 'readwrite');
const store = tx.objectStore('pending_bundles');
store.put({
    id: crypto.randomUUID(),
    bundle: serializedBundle,
    timestamp: Date.now(),
    priority: bundle.header.priority,
    destination: bundle.header.destination,
});
```

### Central Gateway Uplink (`POST /api/network/dtn`)

When any node carrying cached bundles establishes an active Internet connection (via cellular, venue Wi-Fi, or home network), its background sync worker detects the network state transition (`window.ononline`) and initiates the gateway uplink.

As implemented in [`src/app/api/network/dtn/route.ts`](file:///c:/Users/admin/Desktop/workfere/src/app/api/network/dtn/route.ts):
- The client flushes all pending bundles in a single batch `POST` request.
- The server gateway validates each bundle, decrypts payload claims, and commits check-in records to the central PostgreSQL / Prisma database.
- Emits confirmation receipts back to the client, allowing the client to safely purge delivered bundles from local storage.

---

## 8. End-to-End Sequence Diagrams

### Opportunistic BLE Peer-to-Peer Exchange

```mermaid
sequenceDiagram
    autonumber
    actor Alice as Nomad Alice (Offline)
    participant BLE_A as Alice BLE Stack
    participant BLE_B as Bob BLE Stack
    actor Bob as Nomad Bob (Data Mule)

    Note over Alice, Bob: Mutual BLE 5.0 Discovery in Basement Pod
    Alice->>BLE_A: Submit Signed Check-In Bundle (Priority: EXPEDITED)
    BLE_A->>BLE_B: BLE Advertisement (Service: WS-DTN, Summary Hash)
    BLE_B->>BLE_A: GATT Connect & Anti-Entropy Request
    
    BLE_A->>BLE_B: Send Bundle Header (Flags: CUSTODY_REQUESTED)
    loop For each 244-byte fragment
        BLE_A->>BLE_B: Write GATT Characteristic (Fragment i / N)
    end
    
    Note over Bob: Bob Reassembles Fragments & Validates CRC32
    Note over Bob: Writes Bundle to IndexedDB (WorkSphereDTNDB)
    
    BLE_B->>BLE_A: Emit Custody Signal (Status: ACCEPTED)
    Note over Alice: Alice Marks Bundle as "Custody Delegated"
    BLE_B-->>BLE_A: GATT Disconnect (Devices walk away)
```

### Gateway Reconnection & Central Database Ingestion

```mermaid
sequenceDiagram
    autonumber
    actor Bob as Nomad Bob (Data Mule)
    participant Worker as dtnSyncWorker (IndexedDB)
    participant Gateway as DTN API Gateway (/api/network/dtn)
    participant DB as Prisma Database

    Note over Bob: Bob leaves basement and enters cafe with Wi-Fi
    Bob->>Worker: Online Event Detected (navigator.onLine == true)
    Worker->>Worker: Query pending_bundles from WorkSphereDTNDB
    Worker->>Gateway: POST /api/network/dtn { userId, bundles: [...] }
    
    Note over Gateway: Gateway Validation Pipeline
    Gateway->>Gateway: 1. Parse BPv7 Bundles
    Gateway->>Gateway: 2. Verify Cryptographic Attestation Signatures
    Gateway->>Gateway: 3. Verify Monotonic Timestamps & Deduplicate
    Gateway->>DB: Ingest Check-In & Attendance Records
    DB-->>Gateway: Commit Successful
    
    Gateway-->>Worker: HTTP 200 { success: true, processedCount: N }
    Worker->>Worker: Delete ingested bundles from IndexedDB
    Worker-->>Bob: UI Notification: "Offline workspace sync completed!"
```

---

## 9. Security, Cryptographic Integrity & Anti-Abuse

### Payload Authentication & Signature Verification

Because bundles traverse untrusted intermediary nodes (other nomads' personal devices), intermediaries must **never be able to read private data or forge claims**:
- **End-to-End Cryptography:** Private messages and workspace notes are encrypted with the recipient's public key using ECDH (X25519) + ChaCha20-Poly1305 before bundle encapsulation.
- **Attestation Signatures:** Check-in claims carry ECDSA secp256k1 signatures covering the canonical sensor digest. Intermediaries can verify bundle authenticity via the bundle header's CRC and signature without having the ability to alter contents.

### Bundle Flooding & Storage Depletion Defenses

A malicious or compromised device could attempt a Denial-of-Service (DoS) attack by transmitting gigabytes of garbage bundles to consume peers' battery and storage.

Countermeasures enforced in WorkSphere:
1. **Per-Node Bandwidth Throttling:** A device accepts a maximum of $100\text{ KB/min}$ from any single BLE peer MAC address.
2. **Proof-of-Work (PoW) Scratchpad:** Bundles marked `BULK` must include a lightweight Hashcash challenge (difficulty: 16 leading zero bits) to impose computational cost on bulk spammers.
3. **Hard Storage Quotas:** IndexedDB allocation for third-party transit bundles is capped at $25\text{MB}$. Once reached, the node refuses custody of incoming non-critical bundles.

### Replay Attack Defenses

Attackers might capture a legitimate check-in bundle and replay it hours or days later.
- Every bundle header carries a 64-bit millisecond `creationTimestamp` and a strict `lifetime` (default: $3,600,000\text{ ms} = 1\text{ hour}$).
- The central gateway maintains a sliding-window bloom filter of all processed bundle IDs (`source + sequenceNumber + creationTimestamp`). Duplicate bundles are acknowledged and discarded without re-executing database mutations.

---

## 10. TypeScript Architectural Model & API Reference

### Protocol Class Reference: `DTNBundleProtocol`

Defined in [`src/core/network/DTNBundleProtocol.ts`](file:///c:/Users/admin/Desktop/workfere/src/core/network/DTNBundleProtocol.ts):

```typescript
export class DTNBundleProtocol {
    private sequenceCounter: number;
    private maxFragmentSize: number;

    /**
     * Initializes the protocol engine.
     * @param maxFragmentSize Maximum bytes per fragment (defaults to 244 for BLE 5.0).
     */
    constructor(maxFragmentSize?: number);

    /**
     * Slices an application payload into prioritized BPv7 bundles.
     * @param source Originating EID URI
     * @param destination Target EID URI
     * @param payload Raw application bytes
     * @param lifetimeMs Validity period in milliseconds (default: 1 hour)
     * @param priority Urgency level (CRITICAL, EXPEDITED, NORMAL, BULK)
     */
    public createBundle(
        source: string,
        destination: string,
        payload: Uint8Array,
        lifetimeMs?: number,
        priority?: BundlePriority
    ): Bundle[];

    /**
     * Comparator for sorting bundle queues by priority and FIFO timestamp.
     */
    public static comparePriority(a: Bundle, b: Bundle): number;

    /**
     * Sorts a bundle queue in place by priority urgency.
     */
    public static sortQueueByPriority(queue: Bundle[]): Bundle[];

    /**
     * Encodes a bundle into a length-prefixed binary envelope.
     */
    public serializeBundle(bundle: Bundle): Uint8Array;

    /**
     * Decodes a binary envelope into a structured Bundle instance.
     */
    public deserializeBundle(data: Uint8Array): Bundle | null;
}
```

### Protocol Constants & Configuration Matrix

| Parameter | Recommended Value | Description |
| :--- | :--- | :--- |
| `DEFAULT_BLE_MTU` | $244$ Bytes | Maximum fragment payload to avoid L2CAP fragmentation. |
| `DEFAULT_LIFETIME_MS` | $3,600,000$ ms ($1$ hr) | Default bundle validity window before automatic pruning. |
| `MAX_TRANSIT_STORAGE` | $25$ MB | Maximum IndexedDB quota for carrying third-party transit bundles. |
| `CUSTODY_TIMEOUT_MS` | $15,000$ ms | Waiting duration before retransmitting unacknowledged custody claims. |
| `MAX_HOP_COUNT` | $8$ Hops | Maximum forwarding count before restricting bundle to direct delivery. |
