/**
 * @file KademliaRoutingTable.test.ts
 * @description Comprehensive unit tests for Kademlia DHT routing table,
 * 256-bit XOR metric, k-bucket Least-Recently-Seen eviction policy, and
 * alpha-concurrent iterative lookup.
 */

import {
  Contact,
  IterativeNodeLookup,
  KBucket,
  KademliaRoutingTable,
  NodeDistance,
} from '../../core/p2p/KademliaRoutingTable';

describe('KademliaRoutingTable & XOR Metric Routing', () => {
  const ID_A = '0000000000000000000000000000000000000000000000000000000000000001';
  const ID_B = '0000000000000000000000000000000000000000000000000000000000000002';
  const ID_C = '0000000000000000000000000000000000000000000000000000000000000003';

  describe('NodeDistance & 256-bit XOR Metric', () => {
    it('hashes arbitrary keys to 64-hex character NodeIds', () => {
      const hash1 = NodeDistance.hashKey('peer-alpha');
      const hash2 = NodeDistance.hashKey('peer-beta');

      expect(hash1).toHaveLength(64);
      expect(hash2).toHaveLength(64);
      expect(hash1).not.toBe(hash2);
    });

    it('exhibits symmetric distance d(x, y) === d(y, x)', () => {
      const distAB = NodeDistance.xorDistance(ID_A, ID_B);
      const distBA = NodeDistance.xorDistance(ID_B, ID_A);

      expect(distAB).toBe(distBA);
      expect(distAB).toBe(3n); // 1 ^ 2 = 3
    });

    it('returns distance zero for identical IDs', () => {
      expect(NodeDistance.xorDistance(ID_A, ID_A)).toBe(0n);
      expect(NodeDistance.getBucketIndex(ID_A, ID_A)).toBe(-1);
    });

    it('calculates the correct k-bucket index based on highest differing bit', () => {
      // 1 ^ 2 = 3 = binary 11 -> highest bit is bit 1
      expect(NodeDistance.getBucketIndex(ID_A, ID_B)).toBe(1);

      // Distance 2^255 has highest bit at index 255
      const topBitId = '8000000000000000000000000000000000000000000000000000000000000000';
      const zeroId = '0000000000000000000000000000000000000000000000000000000000000000';
      expect(NodeDistance.getBucketIndex(zeroId, topBitId)).toBe(255);
    });
  });

  describe('KBucket Least-Recently-Seen (LRS) Management', () => {
    it('adds contacts up to capacity k and preserves insertion order', () => {
      const bucket = new KBucket({ k: 3 });
      const c1: Contact = { nodeId: ID_A, endpoint: '10.0.0.1:8000', lastSeen: 1, failedPings: 0 };
      const c2: Contact = { nodeId: ID_B, endpoint: '10.0.0.2:8000', lastSeen: 2, failedPings: 0 };

      expect(bucket.add(c1)).toEqual({ status: 'added' });
      expect(bucket.add(c2)).toEqual({ status: 'added' });
      expect(bucket.size()).toBe(2);

      const contacts = bucket.getContacts();
      expect(contacts[0].nodeId).toBe(ID_A);
      expect(contacts[1].nodeId).toBe(ID_B);
    });

    it('moves existing contact to tail on refresh', () => {
      const bucket = new KBucket({ k: 3 });
      const c1: Contact = { nodeId: ID_A, endpoint: '10.0.0.1:8000', lastSeen: 1, failedPings: 0 };
      const c2: Contact = { nodeId: ID_B, endpoint: '10.0.0.2:8000', lastSeen: 2, failedPings: 0 };

      bucket.add(c1);
      bucket.add(c2);

      // Re-add c1 (refresh)
      const res = bucket.add(c1);
      expect(res).toEqual({ status: 'updated' });

      // c1 should now be at tail
      const contacts = bucket.getContacts();
      expect(contacts[0].nodeId).toBe(ID_B);
      expect(contacts[1].nodeId).toBe(ID_A);
    });

    it('queues in replacement cache when bucket is full and returns ping candidate', () => {
      const bucket = new KBucket({ k: 2 });
      const c1: Contact = { nodeId: ID_A, endpoint: '10.0.0.1:8000', lastSeen: 1, failedPings: 0 };
      const c2: Contact = { nodeId: ID_B, endpoint: '10.0.0.2:8000', lastSeen: 2, failedPings: 0 };
      const c3: Contact = { nodeId: ID_C, endpoint: '10.0.0.3:8000', lastSeen: 3, failedPings: 0 };

      bucket.add(c1);
      bucket.add(c2);

      const res = bucket.add(c3);
      expect(res.status).toBe('cached');
      if (res.status === 'cached') {
        expect(res.pingCandidate.nodeId).toBe(ID_A); // Head of bucket
      }

      expect(bucket.size()).toBe(2);
      expect(bucket.getReplacementCache()).toHaveLength(1);
      expect(bucket.getReplacementCache()[0].nodeId).toBe(ID_C);
    });

    it('promotes replacement candidate when failed ping threshold is reached', () => {
      const bucket = new KBucket({ k: 2, maxFailedPings: 2 });
      const c1: Contact = { nodeId: ID_A, endpoint: '10.0.0.1:8000', lastSeen: 1, failedPings: 0 };
      const c2: Contact = { nodeId: ID_B, endpoint: '10.0.0.2:8000', lastSeen: 2, failedPings: 0 };
      const c3: Contact = { nodeId: ID_C, endpoint: '10.0.0.3:8000', lastSeen: 3, failedPings: 0 };

      bucket.add(c1);
      bucket.add(c2);
      bucket.add(c3); // Goes to replacement cache

      // First failed ping for c1
      expect(bucket.recordFailedPing(ID_A)).toBe(false);
      expect(bucket.size()).toBe(2);

      // Second failed ping for c1 -> evicted, c3 promoted!
      expect(bucket.recordFailedPing(ID_A)).toBe(true);
      expect(bucket.size()).toBe(2);

      const remaining = bucket.getContacts();
      expect(remaining.map((c) => c.nodeId)).toEqual([ID_B, ID_C]);
      expect(bucket.getReplacementCache()).toHaveLength(0);
    });
  });

  describe('KademliaRoutingTable Routing Engine', () => {
    it('routes contacts into appropriate buckets and ignores self', () => {
      const localId = '0000000000000000000000000000000000000000000000000000000000000000';
      const table = new KademliaRoutingTable({ localNodeId: localId, k: 5 });

      // Add self -> ignored
      expect(table.addContact({ nodeId: localId, endpoint: 'self', lastSeen: 1, failedPings: 0 })).toEqual({
        status: 'ignored',
      });
      expect(table.totalContacts()).toBe(0);

      // Add ID_A (bit 0 diff) -> bucket 0
      table.addContact({ nodeId: ID_A, endpoint: 'peer1', lastSeen: 1, failedPings: 0 });
      expect(table.totalContacts()).toBe(1);
      expect(table.getContact(ID_A)?.endpoint).toBe('peer1');

      // Add ID_B (bit 1 diff) -> bucket 1
      table.addContact({ nodeId: ID_B, endpoint: 'peer2', lastSeen: 2, failedPings: 0 });
      expect(table.totalContacts()).toBe(2);
    });

    it('finds closest contacts sorted by XOR distance to target', () => {
      const localId = '0000000000000000000000000000000000000000000000000000000000000000';
      const table = new KademliaRoutingTable({ localNodeId: localId, k: 5 });

      const c1 = { nodeId: '0000000000000000000000000000000000000000000000000000000000000005', endpoint: 'p5', lastSeen: 1, failedPings: 0 };
      const c2 = { nodeId: '0000000000000000000000000000000000000000000000000000000000000008', endpoint: 'p8', lastSeen: 1, failedPings: 0 };
      const c3 = { nodeId: '0000000000000000000000000000000000000000000000000000000000000002', endpoint: 'p2', lastSeen: 1, failedPings: 0 };

      table.addContact(c1);
      table.addContact(c2);
      table.addContact(c3);

      // Target is 0x01
      // Distances to 0x01:
      // c3 (0x02): 2 ^ 1 = 3
      // c1 (0x05): 5 ^ 1 = 4
      // c2 (0x08): 8 ^ 1 = 9
      const closest = table.findClosest(ID_A, 2);
      expect(closest).toHaveLength(2);
      expect(closest[0].nodeId).toBe(c3.nodeId);
      expect(closest[1].nodeId).toBe(c1.nodeId);
    });
  });

  describe('IterativeNodeLookup (alpha-concurrency)', () => {
    it('discovers target contacts through iterative multi-hop queries', async () => {
      const localId = '0000000000000000000000000000000000000000000000000000000000000000';
      const table = new KademliaRoutingTable({ localNodeId: localId, k: 3 });

      const bootstrapPeer: Contact = {
        nodeId: '0000000000000000000000000000000000000000000000000000000000000010',
        endpoint: 'boot.peer',
        lastSeen: Date.now(),
        failedPings: 0,
      };
      table.addContact(bootstrapPeer);

      const targetId = '0000000000000000000000000000000000000000000000000000000000000001';

      // Mock remote node responses
      const mockNetwork = new Map<string, Contact[]>([
        [
          bootstrapPeer.nodeId,
          [
            {
              nodeId: '0000000000000000000000000000000000000000000000000000000000000005',
              endpoint: 'hop1.peer',
              lastSeen: Date.now(),
              failedPings: 0,
            },
          ],
        ],
        [
          '0000000000000000000000000000000000000000000000000000000000000005',
          [
            {
              nodeId: targetId,
              endpoint: 'target.peer',
              lastSeen: Date.now(),
              failedPings: 0,
            },
          ],
        ],
      ]);

      const lookupCoordinator = new IterativeNodeLookup(table, 3);
      const queryFn = async (contact: Contact) => mockNetwork.get(contact.nodeId) || [];

      const result = await lookupCoordinator.lookup(targetId, queryFn);

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].nodeId).toBe(targetId);
    });
  });
});
