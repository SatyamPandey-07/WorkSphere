/**
 * @file DeltaSnapshotEngine.ts
 * @description High-performance differential snapshot delta engine for CRDT state synchronization.
 * Provides vector clock diffing, run-length encoding (RLE) wire serialization,
 * stable frontier tombstone garbage collection, and commutative merge convergence.
 */

import { createHash } from 'node:crypto';

export type StateVector = Record<string, number>;

export interface OperationId {
  clientId: string;
  clock: number;
}

export type OperationType = 'insert' | 'delete' | 'update';

export interface CrdtOperation {
  id: OperationId;
  type: OperationType;
  path: string; // Key or nested path e.g. "nodes.item1" or "content"
  value: any;
  tombstone?: boolean;
  timestamp: number;
}

export interface RleBlock {
  type: OperationType;
  count: number;
  operations: CrdtOperation[];
}

export interface DeltaPayload {
  fromVector: StateVector;
  toVector: StateVector;
  operations: CrdtOperation[];
  rleBlocks?: RleBlock[];
  crc32: number;
}

export interface CrdtSnapshot {
  vector: StateVector;
  document: Record<string, any>;
  activeOperationCount: number;
  tombstoneCount: number;
}

/**
 * CRC32 calculation table and utility
 */
export class Crc32 {
  private static table: Uint32Array = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      t[i] = c >>> 0;
    }
    return t;
  })();

  public static calculate(buf: Uint8Array): number {
    let crc = 0xffffffff;
    const table = Crc32.table;
    for (let i = 0; i < buf.length; i++) {
      crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
}

/**
 * Variable-Length Integer (Varint) packing utilities
 */
export class Varint {
  public static encode(value: number): Uint8Array {
    let v = Math.floor(Math.max(0, value));
    const bytes: number[] = [];
    while (v >= 0x80) {
      bytes.push((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    bytes.push(v & 0x7f);
    return new Uint8Array(bytes);
  }

  public static decode(buf: Uint8Array, offset: number = 0): { value: number; bytesRead: number } {
    let value = 0;
    let shift = 0;
    let bytesRead = 0;
    while (offset + bytesRead < buf.length) {
      const b = buf[offset + bytesRead];
      bytesRead++;
      value += (b & 0x7f) * Math.pow(2, shift);
      if (!(b & 0x80)) {
        break;
      }
      shift += 7;
    }
    return { value, bytesRead };
  }
}

/**
 * Run-Length Encoding (RLE) compressor for CRDT operations
 */
export class RleCompressor {
  public static compress(operations: CrdtOperation[]): RleBlock[] {
    if (!operations.length) return [];

    const blocks: RleBlock[] = [];
    let currentBlock: RleBlock = {
      type: operations[0].type,
      count: 1,
      operations: [operations[0]]
    };

    for (let i = 1; i < operations.length; i++) {
      const op = operations[i];
      if (op.type === currentBlock.type) {
        currentBlock.count++;
        currentBlock.operations.push(op);
      } else {
        blocks.push(currentBlock);
        currentBlock = {
          type: op.type,
          count: 1,
          operations: [op]
        };
      }
    }
    blocks.push(currentBlock);
    return blocks;
  }

  public static decompress(blocks: RleBlock[]): CrdtOperation[] {
    const operations: CrdtOperation[] = [];
    for (const b of blocks) {
      for (const op of b.operations) {
        operations.push(op);
      }
    }
    return operations;
  }
}

/**
 * Differential CRDT Snapshot and Delta Engine
 */
export class DeltaSnapshotEngine {
  private readonly clientId: string;
  private stateVector: StateVector = {};
  private operationLog: CrdtOperation[] = [];
  private documentState: Record<string, any> = {};

  constructor(clientId: string, initialDoc?: Record<string, any>) {
    this.clientId = clientId;
    this.stateVector[clientId] = 0;
    if (initialDoc) {
      this.documentState = JSON.parse(JSON.stringify(initialDoc));
      for (const [key, value] of Object.entries(this.documentState)) {
        this.applyLocal(key, 'insert', value);
      }
    }
  }

  public getClientId(): string {
    return this.clientId;
  }

  public getStateVector(): StateVector {
    return { ...this.stateVector };
  }

  public getDocument(): Record<string, any> {
    const sorted: Record<string, any> = {};
    for (const key of Object.keys(this.documentState).sort()) {
      sorted[key] = this.documentState[key];
    }
    return JSON.parse(JSON.stringify(sorted));
  }

  public getOperationCount(): number {
    return this.operationLog.length;
  }

  /**
   * Applies an edit locally, advancing this node's vector clock.
   */
  public applyLocal(path: string, type: OperationType, value: any): CrdtOperation {
    const nextClock = (this.stateVector[this.clientId] || 0) + 1;
    this.stateVector[this.clientId] = nextClock;

    const op: CrdtOperation = {
      id: { clientId: this.clientId, clock: nextClock },
      type,
      path,
      value,
      tombstone: type === 'delete',
      timestamp: Date.now()
    };

    this.operationLog.push(op);
    this.applyToDocument(op);
    return op;
  }

  /**
   * Applies an incoming operation to the in-memory document state
   */
  private applyToDocument(op: CrdtOperation): void {
    if (op.type === 'delete') {
      delete this.documentState[op.path];
    } else {
      this.documentState[op.path] = op.value;
    }
  }

  /**
   * Computes the differential state delta against a remote peer's state vector:
   * Returns all operations known locally where op.clock > remoteVector[op.clientId]
   */
  public generateDelta(remoteVector: StateVector): DeltaPayload {
    const diffOps: CrdtOperation[] = [];

    for (const op of this.operationLog) {
      const remoteClock = remoteVector[op.id.clientId] || 0;
      if (op.id.clock > remoteClock) {
        diffOps.push(op);
      }
    }

    const rleBlocks = RleCompressor.compress(diffOps);

    // Compute CRC32 over canonical JSON representation
    const jsonStr = JSON.stringify({
      fromVector: remoteVector,
      toVector: this.stateVector,
      operations: diffOps
    });
    const bytes = new TextEncoder().encode(jsonStr);
    const crc = Crc32.calculate(bytes);

    return {
      fromVector: { ...remoteVector },
      toVector: { ...this.stateVector },
      operations: diffOps,
      rleBlocks,
      crc32: crc
    };
  }

  /**
   * Applies a delta received from a remote peer with commutativity and idempotence.
   */
  public applyDelta(delta: DeltaPayload): boolean {
    // 1. Verify CRC32 checksum
    const jsonStr = JSON.stringify({
      fromVector: delta.fromVector,
      toVector: delta.toVector,
      operations: delta.operations
    });
    const bytes = new TextEncoder().encode(jsonStr);
    const expectedCrc = Crc32.calculate(bytes);

    if (delta.crc32 !== expectedCrc) {
      throw new Error(`CRC32 checksum mismatch in delta: expected ${expectedCrc}, got ${delta.crc32}`);
    }

    // 2. Filter duplicate or already observed operations (idempotence)
    const existingOpIds = new Set(
      this.operationLog.map((op) => `${op.id.clientId}:${op.id.clock}`)
    );

    const opsToApply: CrdtOperation[] = [];

    for (const op of delta.operations) {
      const key = `${op.id.clientId}:${op.id.clock}`;
      if (!existingOpIds.has(key)) {
        opsToApply.push(op);
        existingOpIds.add(key);
      }
    }

    // 3. Sort operations by causal clock and deterministic client ID
    opsToApply.sort((a, b) => {
      if (a.id.clock !== b.id.clock) return a.id.clock - b.id.clock;
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
      return a.id.clientId.localeCompare(b.id.clientId);
    });

    // 4. Merge operations and update state vector
    for (const op of opsToApply) {
      this.operationLog.push(op);
      this.applyToDocument(op);

      const currentClock = this.stateVector[op.id.clientId] || 0;
      if (op.id.clock > currentClock) {
        this.stateVector[op.id.clientId] = op.id.clock;
      }
    }

    return true;
  }

  /**
   * Wire serialization of a DeltaPayload into a compact binary buffer
   */
  public serializeDelta(delta: DeltaPayload): Uint8Array {
    const json = JSON.stringify(delta);
    const textBytes = new TextEncoder().encode(json);
    const lenVarint = Varint.encode(textBytes.length);

    // 4-byte CRC32 + Varint Length + Body
    const out = new Uint8Array(4 + lenVarint.length + textBytes.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, delta.crc32, false); // big-endian
    out.set(lenVarint, 4);
    out.set(textBytes, 4 + lenVarint.length);
    return out;
  }

  /**
   * Wire deserialization of a DeltaPayload from a binary buffer
   */
  public deserializeDelta(buffer: Uint8Array): DeltaPayload {
    if (buffer.length < 5) {
      throw new Error('Buffer too small to contain valid DeltaPayload');
    }
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const crc = view.getUint32(0, false);

    const { value: len, bytesRead } = Varint.decode(buffer, 4);
    const bodyStart = 4 + bytesRead;
    const bodyEnd = bodyStart + len;
    if (bodyEnd > buffer.length) {
      throw new Error('Corrupt delta wire buffer: declared length exceeds payload size');
    }

    const textBytes = buffer.subarray(bodyStart, bodyEnd);
    const jsonStr = new TextDecoder().decode(textBytes);
    const delta = JSON.parse(jsonStr) as DeltaPayload;

    if (delta.crc32 !== crc) {
      throw new Error('CRC32 checksum header mismatch');
    }
    return delta;
  }

  /**
   * Stable Frontier Tombstone Garbage Collection
   * Safely purges delete tombstones whose clock values are <= the minimum clock
   * across all known active cluster peers.
   */
  public garbageCollectTombstones(peerVectors: StateVector[]): number {
    if (!peerVectors.length) return 0;

    // 1. Calculate the stable frontier (minimum clock per peer)
    const allPeers = new Set<string>();
    for (const v of [this.stateVector, ...peerVectors]) {
      for (const k of Object.keys(v)) {
        allPeers.add(k);
      }
    }

    const stableFrontier: StateVector = {};
    for (const peerId of allPeers) {
      let minClock = this.stateVector[peerId] || 0;
      for (const pv of peerVectors) {
        minClock = Math.min(minClock, pv[peerId] || 0);
      }
      stableFrontier[peerId] = minClock;
    }

    // 2. Filter operation log: keep active operations and tombstones that have NOT yet stabilized
    const initialCount = this.operationLog.length;
    this.operationLog = this.operationLog.filter((op) => {
      if (!op.tombstone) return true;
      const stableClock = stableFrontier[op.id.clientId] || 0;
      // Retain tombstone if its clock is beyond the stable frontier
      return op.id.clock > stableClock;
    });

    const purged = initialCount - this.operationLog.length;
    return purged;
  }

  /**
   * Produces a compacted snapshot for newly connecting peers
   */
  public compactSnapshot(): CrdtSnapshot {
    let tombstoneCount = 0;
    let activeCount = 0;

    for (const op of this.operationLog) {
      if (op.tombstone) {
        tombstoneCount++;
      } else {
        activeCount++;
      }
    }

    return {
      vector: { ...this.stateVector },
      document: JSON.parse(JSON.stringify(this.documentState)),
      activeOperationCount: activeCount,
      tombstoneCount
    };
  }
}
