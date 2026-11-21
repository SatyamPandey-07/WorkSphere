/**
 * BundleRoutingCoordinator.ts
 * Delay-Tolerant Networking (DTN) Bundle Protocol Routing Engine & Custody Coordinator.
 * Complies with RFC 5050 / RFC 7242 principles for opportunistic multi-hop contact graph
 * routing, custody transfer signaling, bundle fragmentation/reassembly, and priority queueing.
 */

import { createHash, createHmac } from 'crypto';

export type EndpointID = string;

export type BundlePriority = 'EXPEDITED' | 'NORMAL' | 'BULK';

export interface BundleHeader {
  bundleId: string;
  source: EndpointID;
  destination: EndpointID;
  currentCustodian: EndpointID;
  creationTimestamp: number;
  lifetimeMs: number;
  priority: BundlePriority;
  custodyTransferRequested: boolean;
  isFragment?: boolean;
  fragmentOffset?: number;
  totalPayloadLength?: number;
  fragmentGroupId?: string;
}

export interface Bundle {
  header: BundleHeader;
  payload: string;
  payloadDigest: string;
  custodyChain: string[];
}

export interface ContactWindow {
  contactId: string;
  peer: EndpointID;
  startTime: number;
  endTime: number;
  throughputBps: number; // Bytes per second
  isActive: boolean;
}

export type CustodyReasonCode =
  | 'SUCCESS'
  | 'STORAGE_EXHAUSTED'
  | 'EXPIRED'
  | 'CORRUPTED'
  | 'UNREACHABLE';

export interface CustodySignal {
  bundleId: string;
  custodian: EndpointID;
  accepted: boolean;
  reasonCode: CustodyReasonCode;
  timestamp: number;
  signature: string;
}

export interface DispatchResult {
  dispatched: {
    bundleId: string;
    peer: EndpointID;
    bytesSent: number;
  }[];
  deferred: string[];
}

export interface StorageUsage {
  usedBytes: number;
  maxBytes: number;
  percentage: number;
  count: number;
}

export class BundleRoutingCoordinator {
  private localEndpoint: EndpointID;
  private maxStorageCapacityBytes: number;
  private secretKey: string;

  private storageMap = new Map<string, Bundle>();
  private contacts = new Map<string, ContactWindow>();
  private routes = new Map<EndpointID, EndpointID[]>();
  private fragmentStore = new Map<string, Map<number, Bundle>>();
  private custodyRecords = new Map<string, { custodian: EndpointID; state: 'HELD' | 'DELEGATED' | 'RELEASED' }>();
  private custodyAuditTrail: CustodySignal[] = [];

  constructor(
    localEndpoint: EndpointID,
    maxStorageCapacityBytes = 10 * 1024 * 1024, // 10 MB default
    secretKey = 'dtn-custody-secret'
  ) {
    this.localEndpoint = localEndpoint;
    this.maxStorageCapacityBytes = maxStorageCapacityBytes;
    this.secretKey = secretKey;
  }

  public getLocalEndpoint(): EndpointID {
    return this.localEndpoint;
  }

  public computeDigest(data: string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  public computeHmac(data: string): string {
    return createHmac('sha256', this.secretKey).update(data).digest('hex');
  }

  public addContact(contact: ContactWindow): void {
    this.contacts.set(contact.contactId, { ...contact });
  }

  public removeContact(contactId: string): void {
    this.contacts.delete(contactId);
  }

  public setContactActive(contactId: string, isActive: boolean): void {
    const contact = this.contacts.get(contactId);
    if (contact) {
      contact.isActive = isActive;
    }
  }

  public registerRoute(destination: EndpointID, nextHops: EndpointID[]): void {
    this.routes.set(destination, [...nextHops]);
  }

  public createBundle(
    destination: EndpointID,
    payload: string | Record<string, any>,
    options?: {
      priority?: BundlePriority;
      lifetimeMs?: number;
      custodyRequested?: boolean;
    }
  ): Bundle {
    const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const now = Date.now();
    const digest = this.computeDigest(payloadStr);
    const bundleId = `bundle_${now}_${Math.random().toString(36).substring(2, 9)}`;

    const bundle: Bundle = {
      header: {
        bundleId,
        source: this.localEndpoint,
        destination,
        currentCustodian: this.localEndpoint,
        creationTimestamp: now,
        lifetimeMs: options?.lifetimeMs ?? 86400000, // 24 hours
        priority: options?.priority ?? 'NORMAL',
        custodyTransferRequested: options?.custodyRequested ?? true,
      },
      payload: payloadStr,
      payloadDigest: digest,
      custodyChain: [this.localEndpoint],
    };

    this.storeBundle(bundle);
    if (bundle.header.custodyTransferRequested) {
      this.custodyRecords.set(bundleId, {
        custodian: this.localEndpoint,
        state: 'HELD',
      });
    }

    return bundle;
  }

  public fragmentBundle(bundle: Bundle, maxChunkSizeBytes: number): Bundle[] {
    if (maxChunkSizeBytes <= 0) {
      throw new Error('Chunk size must be positive');
    }

    const payload = bundle.payload;
    const totalLength = payload.length;

    if (totalLength <= maxChunkSizeBytes) {
      return [bundle];
    }

    const groupId = `frag_${bundle.header.bundleId}`;
    const fragments: Bundle[] = [];
    let offset = 0;
    let seq = 0;

    while (offset < totalLength) {
      const chunk = payload.substring(offset, offset + maxChunkSizeBytes);
      const fragId = `${bundle.header.bundleId}_part${seq}`;
      const frag: Bundle = {
        header: {
          ...bundle.header,
          bundleId: fragId,
          isFragment: true,
          fragmentOffset: offset,
          totalPayloadLength: totalLength,
          fragmentGroupId: groupId,
        },
        payload: chunk,
        payloadDigest: this.computeDigest(chunk),
        custodyChain: [...bundle.custodyChain],
      };
      fragments.push(frag);
      offset += chunk.length;
      seq++;
    }

    return fragments;
  }

  public receiveBundle(
    bundle: Bundle,
    currentTime: number = Date.now()
  ): {
    accepted: boolean;
    signal: CustodySignal;
    isReassembled?: boolean;
    reassembledBundle?: Bundle;
  } {
    // 1. Verify expiration
    const expiry = bundle.header.creationTimestamp + bundle.header.lifetimeMs;
    if (currentTime > expiry) {
      const signal = this.createCustodySignal(bundle.header.bundleId, false, 'EXPIRED', currentTime);
      return { accepted: false, signal };
    }

    // 2. Verify payload integrity
    const computedDigest = this.computeDigest(bundle.payload);
    if (computedDigest !== bundle.payloadDigest) {
      const signal = this.createCustodySignal(bundle.header.bundleId, false, 'CORRUPTED', currentTime);
      return { accepted: false, signal };
    }

    // 3. Storage capacity check and potential eviction
    const bundleSize = this.getBundleByteSize(bundle);
    const usage = this.getStorageUsage();
    if (usage.usedBytes + bundleSize > this.maxStorageCapacityBytes) {
      const freed = this.evictLowestPriorityBundles(bundleSize, bundle.header.priority);
      if (freed < bundleSize) {
        const signal = this.createCustodySignal(bundle.header.bundleId, false, 'STORAGE_EXHAUSTED', currentTime);
        return { accepted: false, signal };
      }
    }

    // 4. Handle Fragment Reassembly if applicable
    if (bundle.header.isFragment && bundle.header.fragmentGroupId && bundle.header.totalPayloadLength) {
      const groupId = bundle.header.fragmentGroupId;
      if (!this.fragmentStore.has(groupId)) {
        this.fragmentStore.set(groupId, new Map());
      }
      const groupMap = this.fragmentStore.get(groupId)!;
      groupMap.set(bundle.header.fragmentOffset ?? 0, bundle);

      // Check if complete
      let receivedBytes = 0;
      for (const frag of groupMap.values()) {
        receivedBytes += frag.payload.length;
      }

      if (receivedBytes >= bundle.header.totalPayloadLength) {
        // Reassemble fragments sorted by offset
        const sortedOffsets = Array.from(groupMap.keys()).sort((a, b) => a - b);
        let fullPayload = '';
        for (const off of sortedOffsets) {
          fullPayload += groupMap.get(off)!.payload;
        }

        const baseBundleId = groupId.replace('frag_', '');
        const reassembled: Bundle = {
          header: {
            ...bundle.header,
            bundleId: baseBundleId,
            isFragment: false,
            fragmentOffset: undefined,
            totalPayloadLength: undefined,
            fragmentGroupId: undefined,
            currentCustodian: this.localEndpoint,
          },
          payload: fullPayload,
          payloadDigest: this.computeDigest(fullPayload),
          custodyChain: [...bundle.custodyChain, this.localEndpoint],
        };

        // Clean fragment store and store reassembled bundle
        this.fragmentStore.delete(groupId);
        this.storeBundle(reassembled);

        const signal = this.createCustodySignal(bundle.header.bundleId, true, 'SUCCESS', currentTime);
        return { accepted: true, signal, isReassembled: true, reassembledBundle: reassembled };
      } else {
        // Fragment buffered waiting for remaining chunks
        const signal = this.createCustodySignal(bundle.header.bundleId, true, 'SUCCESS', currentTime);
        return { accepted: true, signal, isReassembled: false };
      }
    }

    // 5. Store ordinary bundle
    const updatedBundle: Bundle = {
      ...bundle,
      header: {
        ...bundle.header,
        currentCustodian: this.localEndpoint,
      },
      custodyChain: bundle.custodyChain.includes(this.localEndpoint)
        ? bundle.custodyChain
        : [...bundle.custodyChain, this.localEndpoint],
    };

    this.storeBundle(updatedBundle);
    if (updatedBundle.header.custodyTransferRequested) {
      this.custodyRecords.set(updatedBundle.header.bundleId, {
        custodian: this.localEndpoint,
        state: 'HELD',
      });
    }

    const signal = this.createCustodySignal(bundle.header.bundleId, true, 'SUCCESS', currentTime);
    return { accepted: true, signal };
  }

  public forwardBundles(currentTime: number = Date.now()): DispatchResult {
    const result: DispatchResult = {
      dispatched: [],
      deferred: [],
    };

    // Filter active contacts with valid time windows
    const activeContacts = Array.from(this.contacts.values()).filter(
      (c) => c.isActive && currentTime >= c.startTime && currentTime <= c.endTime
    );

    if (activeContacts.length === 0) {
      result.deferred = Array.from(this.storageMap.keys());
      return result;
    }

    // Sort bundles by priority: EXPEDITED > NORMAL > BULK, then FIFO
    const priorityWeight: Record<BundlePriority, number> = {
      EXPEDITED: 3,
      NORMAL: 2,
      BULK: 1,
    };

    const sortedBundles = Array.from(this.storageMap.values()).sort((a, b) => {
      const diff = priorityWeight[b.header.priority] - priorityWeight[a.header.priority];
      if (diff !== 0) return diff;
      return a.header.creationTimestamp - b.header.creationTimestamp;
    });

    for (const bundle of sortedBundles) {
      // Find candidate next hop
      const candidateContact = this.selectNextHop(bundle.header.destination, activeContacts);
      if (!candidateContact) {
        result.deferred.push(bundle.header.bundleId);
        continue;
      }

      const bundleSize = this.getBundleByteSize(bundle);
      result.dispatched.push({
        bundleId: bundle.header.bundleId,
        peer: candidateContact.peer,
        bytesSent: bundleSize,
      });

      // Update custody status to DELEGATED if custody was requested
      if (bundle.header.custodyTransferRequested) {
        const record = this.custodyRecords.get(bundle.header.bundleId);
        if (record) {
          record.state = 'DELEGATED';
        }
      } else {
        // If no custody requested, we can safely prune immediately upon dispatch
        this.storageMap.delete(bundle.header.bundleId);
      }
    }

    return result;
  }

  public handleCustodySignal(signal: CustodySignal): boolean {
    // Validate signature
    const sigPayload = `${signal.bundleId}:${signal.custodian}:${signal.accepted}:${signal.reasonCode}:${signal.timestamp}`;
    const expectedSig = this.computeHmac(sigPayload);
    if (signal.signature !== expectedSig) {
      return false;
    }

    this.custodyAuditTrail.push(signal);
    const record = this.custodyRecords.get(signal.bundleId);
    if (!record) return false;

    if (signal.accepted) {
      record.state = 'RELEASED';
      record.custodian = signal.custodian;
      // When custody is transferred to downstream peer, we can release from local storage
      this.storageMap.delete(signal.bundleId);
      return true;
    } else {
      // Downstream rejected custody: revert state to HELD to retry another route
      record.state = 'HELD';
      return false;
    }
  }

  public pruneExpiredBundles(currentTime: number = Date.now()): string[] {
    const expired: string[] = [];
    for (const [id, bundle] of this.storageMap.entries()) {
      const expiration = bundle.header.creationTimestamp + bundle.header.lifetimeMs;
      if (currentTime > expiration) {
        expired.push(id);
        this.storageMap.delete(id);
        this.custodyRecords.delete(id);
      }
    }
    return expired;
  }

  public getStorageUsage(): StorageUsage {
    let usedBytes = 0;
    for (const bundle of this.storageMap.values()) {
      usedBytes += this.getBundleByteSize(bundle);
    }
    const percentage = this.maxStorageCapacityBytes > 0
      ? (usedBytes / this.maxStorageCapacityBytes) * 100
      : 100;

    return {
      usedBytes,
      maxBytes: this.maxStorageCapacityBytes,
      percentage,
      count: this.storageMap.size,
    };
  }

  public getStoredBundles(): Bundle[] {
    return Array.from(this.storageMap.values());
  }

  public getBundle(bundleId: string): Bundle | undefined {
    return this.storageMap.get(bundleId);
  }

  public getCustodyRecord(bundleId: string) {
    return this.custodyRecords.get(bundleId);
  }

  public getCustodyAuditTrail(): CustodySignal[] {
    return [...this.custodyAuditTrail];
  }

  // --- Private Helpers ---

  private storeBundle(bundle: Bundle): void {
    this.storageMap.set(bundle.header.bundleId, bundle);
  }

  private getBundleByteSize(bundle: Bundle): number {
    return Buffer.byteLength(bundle.payload, 'utf8') + 256; // Header overhead
  }

  private selectNextHop(destination: EndpointID, activeContacts: ContactWindow[]): ContactWindow | undefined {
    // 1. Direct match with destination
    const direct = activeContacts.find((c) => c.peer === destination);
    if (direct) return direct;

    // 2. Check routing table
    const routeHops = this.routes.get(destination);
    if (routeHops && routeHops.length > 0) {
      for (const hop of routeHops) {
        const contact = activeContacts.find((c) => c.peer === hop);
        if (contact) return contact;
      }
    }

    // 3. Fallback to any active peer with highest throughput
    if (activeContacts.length > 0) {
      return [...activeContacts].sort((a, b) => b.throughputBps - a.throughputBps)[0];
    }

    return undefined;
  }

  private evictLowestPriorityBundles(requiredBytes: number, incomingPriority: BundlePriority): number {
    const priorityWeight: Record<BundlePriority, number> = {
      EXPEDITED: 3,
      NORMAL: 2,
      BULK: 1,
    };

    const targetWeight = priorityWeight[incomingPriority];

    // Candidate bundles with strictly lower priority, or equal priority non-custodial
    const candidates = Array.from(this.storageMap.values())
      .filter((b) => {
        const w = priorityWeight[b.header.priority];
        if (w < targetWeight) return true;
        if (w === targetWeight && !b.header.custodyTransferRequested) return true;
        return false;
      })
      .sort((a, b) => priorityWeight[a.header.priority] - priorityWeight[b.header.priority]);

    let freed = 0;
    for (const candidate of candidates) {
      const size = this.getBundleByteSize(candidate);
      this.storageMap.delete(candidate.header.bundleId);
      this.custodyRecords.delete(candidate.header.bundleId);
      freed += size;
      if (freed >= requiredBytes) {
        break;
      }
    }

    return freed;
  }

  private createCustodySignal(
    bundleId: string,
    accepted: boolean,
    reasonCode: CustodyReasonCode,
    timestamp: number
  ): CustodySignal {
    const sigPayload = `${bundleId}:${this.localEndpoint}:${accepted}:${reasonCode}:${timestamp}`;
    const signature = this.computeHmac(sigPayload);

    return {
      bundleId,
      custodian: this.localEndpoint,
      accepted,
      reasonCode,
      timestamp,
      signature,
    };
  }
}
