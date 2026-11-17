/**
 * @file KademliaRoutingTable.ts
 * @description Kademlia Distributed Hash Table (DHT) routing table implementation with
 * 256-bit XOR metric distance, 256 k-buckets (k=20), Least-Recently-Seen (LRS) replacement cache,
 * and alpha-concurrent (alpha=3) iterative node lookup.
 */

import { createHash, randomBytes } from 'node:crypto';

export interface Contact {
  nodeId: string; // 64-character hex string (256 bits)
  endpoint: string; // Network locator (e.g. multiaddr, ip:port, or peer identifier)
  lastSeen: number; // Unix timestamp in ms
  failedPings: number;
}

export type AddContactResult =
  | { status: 'added' }
  | { status: 'updated' }
  | { status: 'cached'; pingCandidate: Contact }
  | { status: 'ignored' };

export interface KBucketOptions {
  k?: number;
  maxFailedPings?: number;
}

/**
 * 256-bit XOR metric utilities
 */
export class NodeDistance {
  /**
   * Hashes an arbitrary string or buffer to a 256-bit hex NodeId
   */
  static hashKey(key: string | Buffer): string {
    return createHash('sha256').update(key).digest('hex');
  }

  /**
   * Computes the XOR distance between two 256-bit hex NodeIds as a BigInt
   */
  static xorDistance(idA: string, idB: string): bigint {
    const cleanA = idA.replace(/^0x/, '').padStart(64, '0');
    const cleanB = idB.replace(/^0x/, '').padStart(64, '0');
    const bigA = BigInt('0x' + cleanA);
    const bigB = BigInt('0x' + cleanB);
    return bigA ^ bigB;
  }

  /**
   * Returns the k-bucket index (0 to 255) based on the most significant differing bit.
   * If idA === idB, returns -1.
   */
  static getBucketIndex(localId: string, remoteId: string): number {
    const dist = NodeDistance.xorDistance(localId, remoteId);
    if (dist === 0n) {
      return -1;
    }
    // 256-bit distance bit length minus 1 gives the highest differing bit position (0 to 255)
    const binStr = dist.toString(2);
    return binStr.length - 1;
  }
}

/**
 * Single K-Bucket maintaining up to k contacts ordered by recency
 */
export class KBucket {
  readonly k: number;
  readonly maxFailedPings: number;
  private contacts: Contact[] = [];
  private replacementCache: Contact[] = [];

  constructor(options: KBucketOptions = {}) {
    this.k = options.k ?? 20;
    this.maxFailedPings = options.maxFailedPings ?? 3;
  }

  getContacts(): Contact[] {
    return [...this.contacts];
  }

  getReplacementCache(): Contact[] {
    return [...this.replacementCache];
  }

  size(): number {
    return this.contacts.length;
  }

  get(nodeId: string): Contact | undefined {
    const norm = nodeId.toLowerCase();
    return this.contacts.find((c) => c.nodeId.toLowerCase() === norm);
  }

  /**
   * Inserts or refreshes a contact according to Kademlia's Least-Recently-Seen policy.
   * - If already present: moves to tail (most recently seen).
   * - If not present and bucket has space: adds to tail.
   * - If not present and bucket is full: adds to replacement cache and returns candidate to ping.
   */
  add(contact: Contact): AddContactResult {
    const norm = contact.nodeId.toLowerCase();
    const existingIndex = this.contacts.findIndex((c) => c.nodeId.toLowerCase() === norm);

    if (existingIndex !== -1) {
      // Refresh contact: remove and push to tail
      this.contacts.splice(existingIndex, 1);
      this.contacts.push({
        ...contact,
        failedPings: 0,
        lastSeen: Date.now(),
      });
      return { status: 'updated' };
    }

    if (this.contacts.length < this.k) {
      this.contacts.push({
        ...contact,
        failedPings: 0,
        lastSeen: Date.now(),
      });
      return { status: 'added' };
    }

    // Bucket is full: queue in replacement cache if not already cached
    const cachedIndex = this.replacementCache.findIndex((c) => c.nodeId.toLowerCase() === norm);
    if (cachedIndex !== -1) {
      this.replacementCache[cachedIndex] = contact;
    } else {
      if (this.replacementCache.length >= this.k) {
        this.replacementCache.shift(); // Evict oldest cached contact
      }
      this.replacementCache.push(contact);
    }

    // Return the head contact (least recently seen) for health ping verification
    return {
      status: 'cached',
      pingCandidate: this.contacts[0],
    };
  }

  /**
   * Removes a contact by Node ID
   */
  remove(nodeId: string): boolean {
    const norm = nodeId.toLowerCase();
    const idx = this.contacts.findIndex((c) => c.nodeId.toLowerCase() === norm);
    if (idx !== -1) {
      this.contacts.splice(idx, 1);
      this.promoteFromCache();
      return true;
    }

    const cIdx = this.replacementCache.findIndex((c) => c.nodeId.toLowerCase() === norm);
    if (cIdx !== -1) {
      this.replacementCache.splice(cIdx, 1);
      return true;
    }

    return false;
  }

  /**
   * Records a failed ping for a contact. If threshold exceeded, evicts contact.
   */
  recordFailedPing(nodeId: string): boolean {
    const norm = nodeId.toLowerCase();
    const idx = this.contacts.findIndex((c) => c.nodeId.toLowerCase() === norm);
    if (idx === -1) return false;

    this.contacts[idx].failedPings += 1;
    if (this.contacts[idx].failedPings >= this.maxFailedPings) {
      this.contacts.splice(idx, 1);
      this.promoteFromCache();
      return true;
    }
    return false;
  }

  private promoteFromCache(): void {
    if (this.contacts.length < this.k && this.replacementCache.length > 0) {
      const promoted = this.replacementCache.shift()!;
      this.contacts.push({
        ...promoted,
        failedPings: 0,
        lastSeen: Date.now(),
      });
    }
  }
}

export interface KademliaRoutingTableOptions {
  localNodeId?: string;
  k?: number;
  maxFailedPings?: number;
}

/**
 * Distributed Kademlia Routing Table maintaining 256 k-buckets
 */
export class KademliaRoutingTable {
  readonly localNodeId: string;
  readonly k: number;
  readonly maxFailedPings: number;
  private readonly buckets: KBucket[];

  constructor(options: KademliaRoutingTableOptions = {}) {
    this.localNodeId = options.localNodeId ?? randomBytes(32).toString('hex');
    this.k = options.k ?? 20;
    this.maxFailedPings = options.maxFailedPings ?? 3;

    this.buckets = Array.from(
      { length: 256 },
      () => new KBucket({ k: this.k, maxFailedPings: this.maxFailedPings })
    );
  }

  /**
   * Inserts or refreshes a remote contact in the corresponding bucket
   */
  addContact(contact: Contact): AddContactResult {
    if (contact.nodeId.toLowerCase() === this.localNodeId.toLowerCase()) {
      return { status: 'ignored' };
    }

    const bucketIdx = NodeDistance.getBucketIndex(this.localNodeId, contact.nodeId);
    if (bucketIdx < 0 || bucketIdx >= 256) {
      return { status: 'ignored' };
    }

    return this.buckets[bucketIdx].add(contact);
  }

  /**
   * Retrieves a contact by Node ID
   */
  getContact(nodeId: string): Contact | undefined {
    const bucketIdx = NodeDistance.getBucketIndex(this.localNodeId, nodeId);
    if (bucketIdx < 0 || bucketIdx >= 256) return undefined;
    return this.buckets[bucketIdx].get(nodeId);
  }

  /**
   * Removes a contact from its corresponding bucket
   */
  removeContact(nodeId: string): boolean {
    const bucketIdx = NodeDistance.getBucketIndex(this.localNodeId, nodeId);
    if (bucketIdx < 0 || bucketIdx >= 256) return false;
    return this.buckets[bucketIdx].remove(nodeId);
  }

  /**
   * Records a failed ping for a contact
   */
  recordFailedPing(nodeId: string): boolean {
    const bucketIdx = NodeDistance.getBucketIndex(this.localNodeId, nodeId);
    if (bucketIdx < 0 || bucketIdx >= 256) return false;
    return this.buckets[bucketIdx].recordFailedPing(nodeId);
  }

  /**
   * Finds the `count` closest contacts to targetId sorted by XOR distance
   */
  findClosest(targetId: string, count: number = this.k): Contact[] {
    const allContacts: Contact[] = [];
    for (const b of this.buckets) {
      allContacts.push(...b.getContacts());
    }

    return allContacts
      .map((c) => ({
        contact: c,
        distance: NodeDistance.xorDistance(c.nodeId, targetId),
      }))
      .sort((a, b) => {
        if (a.distance < b.distance) return -1;
        if (a.distance > b.distance) return 1;
        return 0;
      })
      .slice(0, count)
      .map((item) => item.contact);
  }

  /**
   * Returns total active contacts in all buckets
   */
  totalContacts(): number {
    return this.buckets.reduce((acc, b) => acc + b.size(), 0);
  }

  /**
   * Returns bucket by index
   */
  getBucket(index: number): KBucket {
    if (index < 0 || index >= 256) throw new RangeError('Bucket index must be 0..255');
    return this.buckets[index];
  }
}

/**
 * Alpha-concurrent iterative node lookup coordinator
 */
export class IterativeNodeLookup {
  private readonly table: KademliaRoutingTable;
  private readonly alpha: number;

  constructor(table: KademliaRoutingTable, alpha: number = 3) {
    this.table = table;
    this.alpha = alpha;
  }

  /**
   * Performs alpha-concurrent iterative lookup to discover the k closest contacts to a target
   */
  async lookup(
    targetId: string,
    queryFn: (contact: Contact) => Promise<Contact[]>
  ): Promise<Contact[]> {
    const k = this.table.k;
    const visited = new Set<string>();
    const contactMap = new Map<string, Contact>();

    // Initial shortlist: k closest from local routing table
    const initial = this.table.findClosest(targetId, k);
    for (const c of initial) {
      contactMap.set(c.nodeId.toLowerCase(), c);
    }

    while (true) {
      // Sort known unvisited contacts by XOR distance
      const candidates = Array.from(contactMap.values())
        .filter((c) => !visited.has(c.nodeId.toLowerCase()))
        .sort((a, b) => {
          const dA = NodeDistance.xorDistance(a.nodeId, targetId);
          const dB = NodeDistance.xorDistance(b.nodeId, targetId);
          return dA < dB ? -1 : dA > dB ? 1 : 0;
        })
        .slice(0, this.alpha);

      if (candidates.length === 0) {
        break; // All candidate nodes visited
      }

      // Query alpha candidates in parallel
      const queryPromises = candidates.map(async (c) => {
        visited.add(c.nodeId.toLowerCase());
        try {
          const discovered = await queryFn(c);
          return discovered;
        } catch {
          this.table.recordFailedPing(c.nodeId);
          return [];
        }
      });

      const results = await Promise.all(queryPromises);
      let foundCloser = false;

      const currentClosestDist =
        contactMap.size > 0
          ? NodeDistance.xorDistance(
              Array.from(contactMap.values()).sort((a, b) => {
                const dA = NodeDistance.xorDistance(a.nodeId, targetId);
                const dB = NodeDistance.xorDistance(b.nodeId, targetId);
                return dA < dB ? -1 : 1;
              })[0].nodeId,
              targetId
            )
          : null;

      for (const list of results) {
        for (const peer of list) {
          const peerIdNorm = peer.nodeId.toLowerCase();
          if (!contactMap.has(peerIdNorm) && peerIdNorm !== this.table.localNodeId.toLowerCase()) {
            contactMap.set(peerIdNorm, peer);
            this.table.addContact(peer);

            const dist = NodeDistance.xorDistance(peer.nodeId, targetId);
            if (currentClosestDist === null || dist < currentClosestDist) {
              foundCloser = true;
            }
          }
        }
      }

      // Stop if top k contacts are all visited
      const topK = Array.from(contactMap.values())
        .sort((a, b) => {
          const dA = NodeDistance.xorDistance(a.nodeId, targetId);
          const dB = NodeDistance.xorDistance(b.nodeId, targetId);
          return dA < dB ? -1 : dA > dB ? 1 : 0;
        })
        .slice(0, k);

      const allTopKVisited = topK.every((c) => visited.has(c.nodeId.toLowerCase()));
      if (allTopKVisited && !foundCloser) {
        break;
      }
    }

    return Array.from(contactMap.values())
      .sort((a, b) => {
        const dA = NodeDistance.xorDistance(a.nodeId, targetId);
        const dB = NodeDistance.xorDistance(b.nodeId, targetId);
        return dA < dB ? -1 : dA > dB ? 1 : 0;
      })
      .slice(0, k);
  }
}
