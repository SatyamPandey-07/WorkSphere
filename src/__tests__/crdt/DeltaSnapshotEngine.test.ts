/**
 * @file DeltaSnapshotEngine.test.ts
 * @description Unit test suite for DeltaSnapshotEngine CRDT differential snapshot synchronization.
 */

import {
  Crc32,
  DeltaSnapshotEngine,
  RleCompressor,
  Varint
} from '../../core/crdt/DeltaSnapshotEngine';

describe('DeltaSnapshotEngine Test Suite', () => {
  describe('Crc32 & Varint Primitives', () => {
    it('computes deterministic CRC32 and detects modifications', () => {
      const data1 = new TextEncoder().encode('collaborative-workspace-state');
      const data2 = new TextEncoder().encode('collaborative-workspace-state');
      const data3 = new TextEncoder().encode('collaborative-workspace-state-corrupted');

      const crc1 = Crc32.calculate(data1);
      const crc2 = Crc32.calculate(data2);
      const crc3 = Crc32.calculate(data3);

      expect(crc1).toBe(crc2);
      expect(crc1).not.toBe(crc3);
    });

    it('encodes and decodes Varint across multiple byte boundaries', () => {
      const testValues = [0, 1, 127, 128, 255, 300, 16384, 1000000];
      for (const val of testValues) {
        const encoded = Varint.encode(val);
        const { value: decoded, bytesRead } = Varint.decode(encoded);
        expect(decoded).toBe(val);
        expect(bytesRead).toBe(encoded.length);
      }
    });
  });

  describe('RleCompressor', () => {
    it('compresses sequential runs of identical operation types and decompresses losslessly', () => {
      const ops = [
        { id: { clientId: 'c1', clock: 1 }, type: 'insert' as const, path: 'a', value: 1, timestamp: 100 },
        { id: { clientId: 'c1', clock: 2 }, type: 'insert' as const, path: 'b', value: 2, timestamp: 101 },
        { id: { clientId: 'c1', clock: 3 }, type: 'delete' as const, path: 'a', value: null, tombstone: true, timestamp: 102 },
        { id: { clientId: 'c1', clock: 4 }, type: 'delete' as const, path: 'b', value: null, tombstone: true, timestamp: 103 },
        { id: { clientId: 'c1', clock: 5 }, type: 'update' as const, path: 'c', value: 3, timestamp: 104 }
      ];

      const blocks = RleCompressor.compress(ops);
      expect(blocks.length).toBe(3);
      expect(blocks[0].count).toBe(2);
      expect(blocks[1].count).toBe(2);
      expect(blocks[2].count).toBe(1);

      const decompressed = RleCompressor.decompress(blocks);
      expect(decompressed).toEqual(ops);
    });
  });

  describe('Differential Delta Generation and Application', () => {
    it('extracts minimal causal differences based on remote state vector', () => {
      const engineA = new DeltaSnapshotEngine('client-A');
      engineA.applyLocal('title', 'insert', 'Project Alpha');
      engineA.applyLocal('author', 'insert', 'Ritesh');
      engineA.applyLocal('status', 'insert', 'Draft');

      // Peer B knows up to clock 1 for client-A
      const remoteVector = { 'client-A': 1 };
      const delta = engineA.generateDelta(remoteVector);

      expect(delta.operations.length).toBe(2);
      expect(delta.operations[0].id.clock).toBe(2);
      expect(delta.operations[1].id.clock).toBe(3);
      expect(delta.toVector['client-A']).toBe(3);
    });

    it('applies deltas idempotently without duplicating operations', () => {
      const engineA = new DeltaSnapshotEngine('client-A');
      const engineB = new DeltaSnapshotEngine('client-B');

      engineA.applyLocal('key1', 'insert', 'value1');
      engineA.applyLocal('key2', 'insert', 'value2');

      const delta = engineA.generateDelta(engineB.getStateVector());

      // Apply first time
      expect(engineB.applyDelta(delta)).toBe(true);
      expect(engineB.getDocument()).toEqual({ key1: 'value1', key2: 'value2' });
      expect(engineB.getOperationCount()).toBe(2);

      // Apply duplicate delta (replay / duplicate network message)
      expect(engineB.applyDelta(delta)).toBe(true);
      expect(engineB.getDocument()).toEqual({ key1: 'value1', key2: 'value2' });
      expect(engineB.getOperationCount()).toBe(2); // no extra operations added
    });
  });

  describe('Multi-Peer Commutative Convergence', () => {
    it('converges to identical document state regardless of delta arrival order', () => {
      const nodeA = new DeltaSnapshotEngine('node-A');
      const nodeB = new DeltaSnapshotEngine('node-B');
      const nodeC = new DeltaSnapshotEngine('node-C');

      nodeA.applyLocal('fileA', 'insert', 'contentA');
      nodeB.applyLocal('fileB', 'insert', 'contentB');
      nodeC.applyLocal('fileC', 'insert', 'contentC');

      // Generate deltas
      const deltaA = nodeA.generateDelta({});
      const deltaB = nodeB.generateDelta({});
      const deltaC = nodeC.generateDelta({});

      // Apply in order: B, then C on nodeA
      nodeA.applyDelta(deltaB);
      nodeA.applyDelta(deltaC);

      // Apply in order: C, then A on nodeB
      nodeB.applyDelta(deltaC);
      nodeB.applyDelta(deltaA);

      // Apply in order: A, then B on nodeC
      nodeC.applyDelta(deltaA);
      nodeC.applyDelta(deltaB);

      // All three nodes must hold the exact same document
      const docA = nodeA.getDocument();
      const docB = nodeB.getDocument();
      const docC = nodeC.getDocument();

      expect(docA).toEqual({
        fileA: 'contentA',
        fileB: 'contentB',
        fileC: 'contentC'
      });
      expect(docA).toEqual(docB);
      expect(docB).toEqual(docC);
    });
  });

  describe('Binary Wire Serialization and Checksum Verification', () => {
    it('serializes and deserializes deltas across binary wire buffers with integrity validation', () => {
      const engine = new DeltaSnapshotEngine('client-1');
      engine.applyLocal('task1', 'insert', { title: 'Implement FROST', priority: 1 });
      engine.applyLocal('task2', 'insert', { title: 'Implement Delta Engine', priority: 1 });

      const delta = engine.generateDelta({});
      const binary = engine.serializeDelta(delta);
      expect(binary instanceof Uint8Array).toBe(true);

      const deserialized = engine.deserializeDelta(binary);
      expect(deserialized.crc32).toBe(delta.crc32);
      expect(deserialized.operations.length).toBe(delta.operations.length);
      expect(deserialized.operations[0].value).toEqual({ title: 'Implement FROST', priority: 1 });
    });

    it('rejects tampered delta payloads with CRC32 mismatch error', () => {
      const engine = new DeltaSnapshotEngine('client-1');
      engine.applyLocal('prop', 'insert', 'val');
      const delta = engine.generateDelta({});

      const tamperedDelta = {
        ...delta,
        operations: [
          {
            ...delta.operations[0],
            value: 'tampered-value'
          }
        ]
      };

      const receiver = new DeltaSnapshotEngine('client-2');
      expect(() => receiver.applyDelta(tamperedDelta)).toThrow(/CRC32 checksum mismatch/);
    });
  });

  describe('Tombstone Garbage Collection & Snapshot Compaction', () => {
    it('purges tombstones that have stabilized across all cluster peers', () => {
      const engineA = new DeltaSnapshotEngine('client-A');
      engineA.applyLocal('tempKey1', 'insert', 'temp1');
      engineA.applyLocal('tempKey2', 'insert', 'temp2');
      engineA.applyLocal('tempKey1', 'delete', null); // tombstone at clock 3
      engineA.applyLocal('tempKey2', 'delete', null); // tombstone at clock 4
      engineA.applyLocal('keepKey', 'insert', 'persistent');

      expect(engineA.getOperationCount()).toBe(5);

      // Peers B and C have acknowledged client-A up to clock 3
      const peerVectors = [
        { 'client-A': 3, 'client-B': 5 },
        { 'client-A': 4, 'client-C': 2 }
      ];

      // Minimum clock across peers for client-A is 3: tombstone at clock 3 can be purged!
      const purged = engineA.garbageCollectTombstones(peerVectors);
      expect(purged).toBe(1); // clock 3 tombstone purged
      expect(engineA.getOperationCount()).toBe(4);
    });

    it('compacts snapshot baseline with accurate counts', () => {
      const engine = new DeltaSnapshotEngine('client-1');
      engine.applyLocal('k1', 'insert', 'v1');
      engine.applyLocal('k2', 'delete', null);

      const snapshot = engine.compactSnapshot();
      expect(snapshot.activeOperationCount).toBe(1);
      expect(snapshot.tombstoneCount).toBe(1);
      expect(snapshot.document).toEqual({ k1: 'v1' });
    });
  });
});
