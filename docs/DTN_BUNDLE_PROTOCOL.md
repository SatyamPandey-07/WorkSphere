# WorkSphere Delay-Tolerant Networking (DTN) Bundle Protocol

## 1. Overview
The Delay-Tolerant Networking (DTN) layer provides delay-tolerant, store-and-forward bundle routing across network partitions, intermittent connectivity, and offline peer clusters.

---

## 2. Hop-by-Hop Custody Transfer Lifecycle

```mermaid
sequenceDiagram
    autonumber
    participant Source as Source Node
    participant Relay as Custody Relay Node
    participant Dest as Destination Node

    Source->>Source: Generate Bundle + Set Expiration TTL
    Source->>Relay: Forward Bundle (Custody Request = true)
    Relay->>Relay: Store in Persistent Vault (IndexedDB)
    Relay->>Source: Custody Transfer ACK (Bundle ID)
    Source->>Source: Release Local Custody Responsibility
    Note over Relay: Network Partition / Offline Travel
    Relay->>Dest: Forward Bundle upon Reconnection
    Dest->>Relay: Final Delivery ACK
    Relay->>Relay: Prune Bundle from Storage

    {
  "$schema": "[http://json-schema.org/draft-07/schema#](http://json-schema.org/draft-07/schema#)",
  "title": "WorkSphereDTNBundle",
  "type": "object",
  "properties": {
    "bundleId": { "type": "string", "format": "uuid" },
    "sourceNodeId": { "type": "string" },
    "destinationNodeId": { "type": "string" },
    "creationTimestamp": { "type": "integer" },
    "lifetimeMs": { "type": "integer", "default": 86400000 },
    "custodyTransferRequested": { "type": "boolean" },
    "currentCustodianId": { "type": "string" },
    "payloadHash": { "type": "string" },
    "payload": { "type": "string" }
  },
  "required": [
    "bundleId",
    "sourceNodeId",
    "destinationNodeId",
    "creationTimestamp",
    "lifetimeMs",
    "custodyTransferRequested",
    "payloadHash",
    "payload"
  ]
}
import { createHash } from "crypto";

export interface DTNBundle {
  bundleId: string;
  sourceNodeId: string;
  destinationNodeId: string;
  creationTimestamp: number;
  lifetimeMs: number;
  custodyTransferRequested: boolean;
  currentCustodianId: string;
  payloadHash: string;
  payload: string;
}

export function deserializeAndVerifyBundle(rawBinary: ArrayBuffer): DTNBundle {
  const decoder = new TextDecoder();
  const jsonString = decoder.decode(rawBinary);
  const bundle: DTNBundle = JSON.parse(jsonString);

  // Check TTL expiration
  const now = Date.now();
  if (now > bundle.creationTimestamp + bundle.lifetimeMs) {
    throw new Error(`Bundle ${bundle.bundleId} has expired.`);
  }

  // Integrity verification
  const computedHash = createHash("sha256").update(bundle.payload).digest("hex");
  if (computedHash !== bundle.payloadHash) {
    throw new Error(`Integrity check failed for bundle ${bundle.bundleId}`);
  }

  return bundle;
}