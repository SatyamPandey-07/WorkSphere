/**
 * CrdtDocument.ts
 * The core CRDT state tree implementation supporting text and drawing operations.
 * Uses a Last-Writer-Wins (LWW) Register strategy combined with Vector Clocks for conflict resolution.
 * Supports distributed selective undo/redo history stacks with causal vector clock preservation (#5310).
 */

import { CrdtVectorClock, VectorClock } from "./CrdtVectorClock";

export type OperationType =
  "DRAW_STROKE" | "ADD_TEXT" | "UPDATE_TEXT" | "DELETE_ELEMENT";

export interface CrdtOperation {
  id: string;
  type: OperationType;
  nodeId: string;
  timestamp: number;
  vectorClock: VectorClock;
  payload: Record<string, unknown>;
}

export interface CrdtState {
  elements: Record<string, CrdtOperation>;
  vectorClock: VectorClock;
}

export interface HistoryEntry {
  targetId: string;
  appliedOp: CrdtOperation;
  previousOp: CrdtOperation | null;
}

export class CrdtDocument {
  private state: CrdtState;
  private nodeId: string;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private maxHistorySize: number;

  constructor(
    nodeId: string,
    initialState: CrdtState = { elements: {}, vectorClock: {} },
    maxHistorySize: number = 100,
  ) {
    this.nodeId = nodeId;
    this.state = {
      elements: { ...initialState.elements },
      vectorClock: { ...initialState.vectorClock },
    };
    this.maxHistorySize = maxHistorySize;
  }

  private applyInternal(op: Omit<CrdtOperation, "vectorClock">): CrdtOperation {
    const vectorClock = new CrdtVectorClock(this.state.vectorClock);
    vectorClock.increment(this.nodeId);

    const fullOp: CrdtOperation = {
      ...op,
      vectorClock: vectorClock.getClock(),
    };

    this.state.elements[op.id] = fullOp;
    this.state.vectorClock = vectorClock.getClock();

    return fullOp;
  }

  public applyLocalOperation(
    op: Omit<CrdtOperation, "vectorClock">,
  ): CrdtOperation {
    const previousOp = this.state.elements[op.id]
      ? { ...this.state.elements[op.id] }
      : null;
    const fullOp = this.applyInternal(op);

    // ponytail: push to local undo stack and clear redo on fresh local edit
    this.undoStack.push({
      targetId: op.id,
      appliedOp: fullOp,
      previousOp,
    });
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift();
    }
    this.redoStack = [];

    return fullOp;
  }

  public undo(): CrdtOperation | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;

    // Invert the operation: restore previous state or delete if element was newly added
    const inverseOp: Omit<CrdtOperation, "vectorClock"> =
      entry.previousOp && entry.previousOp.type !== "DELETE_ELEMENT"
        ? {
            id: entry.targetId,
            type: entry.previousOp.type,
            nodeId: this.nodeId,
            timestamp: Date.now(),
            payload: { ...entry.previousOp.payload },
          }
        : {
            id: entry.targetId,
            type: "DELETE_ELEMENT",
            nodeId: this.nodeId,
            timestamp: Date.now(),
            payload: { targetId: entry.targetId },
          };

    // ponytail: apply inverse as a new forward operation with monotonically incremented vector clock
    const invertedOp = this.applyInternal(inverseOp);

    this.redoStack.push({
      targetId: entry.targetId,
      appliedOp: invertedOp,
      previousOp: entry.appliedOp,
    });
    if (this.redoStack.length > this.maxHistorySize) {
      this.redoStack.shift();
    }

    return invertedOp;
  }

  public redo(): CrdtOperation | null {
    const entry = this.redoStack.pop();
    if (!entry || !entry.previousOp) return null;

    const redoOp: Omit<CrdtOperation, "vectorClock"> = {
      id: entry.targetId,
      type: entry.previousOp.type,
      nodeId: this.nodeId,
      timestamp: Date.now(),
      payload: { ...entry.previousOp.payload },
    };

    // ponytail: apply redo as a forward operation advancing vector clock
    const reappliedOp = this.applyInternal(redoOp);

    this.undoStack.push({
      targetId: entry.targetId,
      appliedOp: reappliedOp,
      previousOp: entry.appliedOp,
    });
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift();
    }

    return reappliedOp;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public clearHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  public getHistory(): { undoCount: number; redoCount: number } {
    return {
      undoCount: this.undoStack.length,
      redoCount: this.redoStack.length,
    };
  }

  public mergeRemoteOperation(op: CrdtOperation): boolean {
    const existingOp = this.state.elements[op.id];

    // If we already have this operation, ignore
    if (existingOp) {
      const existingClock = new CrdtVectorClock(existingOp.vectorClock);
      const incomingClock = new CrdtVectorClock(op.vectorClock);

      // If incoming is older or concurrent but lower nodeId, reject
      if (incomingClock.compare(existingClock.getClock()) === "before") {
        return false;
      }
      if (incomingClock.compare(existingClock.getClock()) === "concurrent") {
        if (op.nodeId < existingOp.nodeId) {
          return false;
        }
      }
    }

    this.state.elements[op.id] = op;

    const currentClock = new CrdtVectorClock(this.state.vectorClock);
    currentClock.merge(op.vectorClock);
    this.state.vectorClock = currentClock.getClock();

    return true;
  }

  public getState(): CrdtState {
    return {
      elements: { ...this.state.elements },
      vectorClock: { ...this.state.vectorClock },
    };
  }

  public getElements(includeDeleted: boolean = false): CrdtOperation[] {
    const elements = Object.values(this.state.elements).sort(
      (a, b) => a.timestamp - b.timestamp,
    );
    return includeDeleted
      ? elements
      : elements.filter((el) => el.type !== "DELETE_ELEMENT");
  }

  /**
   * Serializes document state into a compressed binary payload using VarInt and RLE tombstone ranges.
   */
  public encodeBinary(): Uint8Array {
    return encodeStateBinary(this.state);
  }

  /**
   * Reconstructs a CrdtDocument instance from a compressed binary state payload.
   */
  public static fromBinary(
    buffer: Uint8Array,
    nodeId: string = "restored-node",
  ): CrdtDocument {
    const state = decodeStateBinary(buffer);
    return new CrdtDocument(nodeId, state);
  }

  /**
   * Static helper to encode a CrdtState directly to binary.
   */
  public static encodeStateBinary(state: CrdtState): Uint8Array {
    return encodeStateBinary(state);
  }

  /**
   * Static helper to decode a CrdtState from binary.
   */
  public static decodeStateBinary(buffer: Uint8Array): CrdtState {
    return decodeStateBinary(buffer);
  }
}

// ---------------------------------------------------------------------------
// VarInt & RLE Compression Implementation
// ---------------------------------------------------------------------------

export interface TombstoneRange {
  nodeId: string;
  clientIdIndex?: number;
  idPrefix: string;
  startSeq: number;
  count: number;
  startTimestamp: number;
  stepTimestamp?: number;
  targetIdPrefix?: string;
  hasDigits?: boolean;
}

/**
 * Encodes an unsigned integer into a variable-length byte array (LEB128/VarInt).
 * Numbers < 128 occupy 1 byte, < 16384 occupy 2 bytes, etc.
 */
export function encodeVarInt(value: number): Uint8Array {
  let v = Math.floor(value);
  if (v < 0) {
    throw new Error("encodeVarInt only supports non-negative integers");
  }
  const bytes: number[] = [];
  while (v >= 0x80) {
    bytes.push((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  bytes.push(v & 0x7f);
  return new Uint8Array(bytes);
}

/**
 * Decodes an unsigned VarInt from a buffer at the given byte offset.
 */
export function decodeVarInt(
  buffer: Uint8Array,
  offset: number = 0,
): { value: number; bytesRead: number } {
  let result = 0;
  let shift = 0;
  let bytesRead = 0;

  while (offset + bytesRead < buffer.length) {
    const byte = buffer[offset + bytesRead];
    bytesRead++;
    result += (byte & 0x7f) * Math.pow(2, shift);
    shift += 7;
    if ((byte & 0x80) === 0) {
      return { value: result, bytesRead };
    }
  }
  throw new Error("Unexpected end of buffer while decoding VarInt");
}

/**
 * Helper to concatenate an array of Uint8Arrays into a single buffer.
 */
export function concatBuffers(buffers: Uint8Array[]): Uint8Array {
  let totalLength = 0;
  for (const b of buffers) {
    totalLength += b.length;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const b of buffers) {
    result.set(b, offset);
    offset += b.length;
  }
  return result;
}

/**
 * Encodes a table of unique strings using VarInt-prefixed lengths.
 */
export function encodeStringTable(strings: string[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [encodeVarInt(strings.length)];
  for (const str of strings) {
    const encoded = encoder.encode(str);
    parts.push(encodeVarInt(encoded.length));
    parts.push(encoded);
  }
  return concatBuffers(parts);
}

/**
 * Decodes a string table from buffer starting at offset.
 */
export function decodeStringTable(
  buffer: Uint8Array,
  offset: number = 0,
): { strings: string[]; bytesRead: number } {
  const decoder = new TextDecoder();
  let currentOffset = offset;
  const { value: count, bytesRead: countBytes } = decodeVarInt(
    buffer,
    currentOffset,
  );
  currentOffset += countBytes;

  const strings: string[] = [];
  for (let i = 0; i < count; i++) {
    const { value: len, bytesRead: lenBytes } = decodeVarInt(
      buffer,
      currentOffset,
    );
    currentOffset += lenBytes;
    if (currentOffset + len > buffer.length) {
      throw new Error("Buffer overrun while reading string from string table");
    }
    const strBytes = buffer.subarray(currentOffset, currentOffset + len);
    strings.push(decoder.decode(strBytes));
    currentOffset += len;
  }
  return { strings, bytesRead: currentOffset - offset };
}

/**
 * Parses an element ID or target ID into prefix and numeric sequence if present.
 */
function parseIdSequence(id: string): {
  prefix: string;
  seq: number;
  hasDigits: boolean;
} {
  const match = id.match(/^(.*?)(\d+)$/);
  if (match) {
    return { prefix: match[1], seq: parseInt(match[2], 10), hasDigits: true };
  }
  return { prefix: id, seq: 0, hasDigits: false };
}

/**
 * Extracts contiguous tombstone sequences into compressed TombstoneRange instances.
 */
export function extractTombstoneRanges(
  tombstones: Record<string, CrdtOperation> | CrdtOperation[],
): TombstoneRange[] {
  const ops: CrdtOperation[] = Array.isArray(tombstones)
    ? tombstones
    : Object.values(tombstones);

  const deleteOps = ops.filter((op) => op.type === "DELETE_ELEMENT");
  if (deleteOps.length === 0) return [];

  interface ParsedTombstone {
    op: CrdtOperation;
    nodeId: string;
    idPrefix: string;
    targetIdPrefix: string;
    seq: number;
    hasDigits: boolean;
    timestamp: number;
  }

  const parsedList: ParsedTombstone[] = deleteOps.map((op) => {
    const parsedId = parseIdSequence(op.id);
    const targetId =
      typeof op.payload?.targetId === "string"
        ? (op.payload.targetId as string)
        : op.id;
    const parsedTarget = parseIdSequence(targetId);
    return {
      op,
      nodeId: op.nodeId,
      idPrefix: parsedId.prefix,
      targetIdPrefix: parsedTarget.prefix,
      seq: parsedId.hasDigits
        ? parsedId.seq
        : parsedTarget.hasDigits
          ? parsedTarget.seq
          : 0,
      hasDigits: parsedId.hasDigits || parsedTarget.hasDigits,
      timestamp: op.timestamp,
    };
  });

  const groups = new Map<string, ParsedTombstone[]>();
  for (const item of parsedList) {
    const key = `${item.nodeId}:::${item.idPrefix}:::${item.targetIdPrefix}:::${item.hasDigits ? 1 : 0}`;
    let group = groups.get(key);
    if (!group) {
      group = [];
      groups.set(key, group);
    }
    group.push(item);
  }

  const ranges: TombstoneRange[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => {
      if (a.seq !== b.seq) return a.seq - b.seq;
      return a.timestamp - b.timestamp;
    });

    let currentRange: TombstoneRange | null = null;
    let prevTimestamp = 0;

    for (const item of group) {
      if (!currentRange) {
        currentRange = {
          nodeId: item.nodeId,
          idPrefix: item.idPrefix,
          targetIdPrefix: item.targetIdPrefix,
          startSeq: item.seq,
          count: 1,
          startTimestamp: item.timestamp,
          stepTimestamp: 0,
          hasDigits: item.hasDigits,
        };
        prevTimestamp = item.timestamp;
      } else if (
        item.hasDigits &&
        item.seq === currentRange.startSeq + currentRange.count
      ) {
        if (currentRange.count === 1) {
          currentRange.stepTimestamp = item.timestamp - prevTimestamp;
        }
        currentRange.count += 1;
        prevTimestamp = item.timestamp;
      } else {
        ranges.push(currentRange);
        currentRange = {
          nodeId: item.nodeId,
          idPrefix: item.idPrefix,
          targetIdPrefix: item.targetIdPrefix,
          startSeq: item.seq,
          count: 1,
          startTimestamp: item.timestamp,
          stepTimestamp: 0,
          hasDigits: item.hasDigits,
        };
        prevTimestamp = item.timestamp;
      }
    }
    if (currentRange) {
      ranges.push(currentRange);
    }
  }

  return ranges;
}

/**
 * Expands compressed TombstoneRange instances back into individual DELETE_ELEMENT CrdtOperations.
 */
export function expandTombstoneRanges(
  ranges: TombstoneRange[],
): CrdtOperation[] {
  const ops: CrdtOperation[] = [];
  for (const range of ranges) {
    for (let i = 0; i < range.count; i++) {
      const seq = range.startSeq + i;
      const hasDigits = range.hasDigits ?? true;
      const id = hasDigits ? `${range.idPrefix}${seq}` : range.idPrefix;
      const targetId = hasDigits
        ? `${range.targetIdPrefix ?? range.idPrefix}${seq}`
        : (range.targetIdPrefix ?? range.idPrefix);
      const timestamp = range.startTimestamp + i * (range.stepTimestamp ?? 0);
      const op: CrdtOperation = {
        id,
        type: "DELETE_ELEMENT",
        nodeId: range.nodeId,
        timestamp,
        vectorClock: { [range.nodeId]: seq || 1 },
        payload: { targetId },
      };
      ops.push(op);
    }
  }
  return ops;
}

/**
 * Encodes contiguous tombstone ranges using Run-Length Encoding (RLE) and VarInts.
 */
export function encodeRleTombstones(
  ranges: TombstoneRange[],
  stringTable?: string[],
): Uint8Array {
  if (!stringTable) {
    const localTable = Array.from(
      new Set(
        ranges.flatMap((r) => [
          r.nodeId,
          r.idPrefix,
          r.targetIdPrefix ?? r.idPrefix,
        ]),
      ),
    );
    const strBytes = encodeStringTable(localTable);
    const rleBytes = encodeRleTombstones(ranges, localTable);
    return concatBuffers([strBytes, rleBytes]);
  }

  const parts: Uint8Array[] = [encodeVarInt(ranges.length)];
  for (const range of ranges) {
    let nodeIdx =
      range.clientIdIndex !== undefined
        ? range.clientIdIndex
        : stringTable.indexOf(range.nodeId);
    if (nodeIdx === -1) nodeIdx = 0;
    let idPrefixIdx = stringTable.indexOf(range.idPrefix);
    if (idPrefixIdx === -1) idPrefixIdx = 0;
    let targetPrefixIdx = stringTable.indexOf(
      range.targetIdPrefix ?? range.idPrefix,
    );
    if (targetPrefixIdx === -1) targetPrefixIdx = idPrefixIdx;

    const flags = (range.hasDigits ?? true) ? 1 : 0;

    parts.push(encodeVarInt(nodeIdx));
    parts.push(encodeVarInt(idPrefixIdx));
    parts.push(encodeVarInt(targetPrefixIdx));
    parts.push(encodeVarInt(flags));
    parts.push(encodeVarInt(range.startSeq));
    parts.push(encodeVarInt(range.count));
    parts.push(encodeVarInt(range.startTimestamp));
    parts.push(encodeVarInt(Math.max(0, range.stepTimestamp ?? 0)));
  }
  return concatBuffers(parts);
}

/**
 * Decodes RLE tombstone ranges from buffer using VarInt decoding.
 */
export function decodeRleTombstones(
  buffer: Uint8Array,
  offset: number = 0,
  stringTable?: string[],
): { ranges: TombstoneRange[]; bytesRead: number } {
  let currentOffset = offset;
  let table = stringTable;
  if (!table) {
    const { strings, bytesRead } = decodeStringTable(buffer, currentOffset);
    table = strings;
    currentOffset += bytesRead;
  }

  const { value: rangeCount, bytesRead: countBytes } = decodeVarInt(
    buffer,
    currentOffset,
  );
  currentOffset += countBytes;

  const ranges: TombstoneRange[] = [];
  for (let i = 0; i < rangeCount; i++) {
    const { value: nodeIdx, bytesRead: b1 } = decodeVarInt(
      buffer,
      currentOffset,
    );
    currentOffset += b1;
    const { value: idPrefixIdx, bytesRead: b2 } = decodeVarInt(
      buffer,
      currentOffset,
    );
    currentOffset += b2;
    const { value: targetPrefixIdx, bytesRead: b3 } = decodeVarInt(
      buffer,
      currentOffset,
    );
    currentOffset += b3;
    const { value: flags, bytesRead: b4 } = decodeVarInt(buffer, currentOffset);
    currentOffset += b4;
    const { value: startSeq, bytesRead: b5 } = decodeVarInt(
      buffer,
      currentOffset,
    );
    currentOffset += b5;
    const { value: count, bytesRead: b6 } = decodeVarInt(buffer, currentOffset);
    currentOffset += b6;
    const { value: startTimestamp, bytesRead: b7 } = decodeVarInt(
      buffer,
      currentOffset,
    );
    currentOffset += b7;
    const { value: stepTimestamp, bytesRead: b8 } = decodeVarInt(
      buffer,
      currentOffset,
    );
    currentOffset += b8;

    const nodeId = table[nodeIdx] ?? `client-${nodeIdx}`;
    const idPrefix = table[idPrefixIdx] ?? "";
    const targetIdPrefix = table[targetPrefixIdx] ?? idPrefix;
    const hasDigits = (flags & 1) === 1;

    ranges.push({
      nodeId,
      clientIdIndex: nodeIdx,
      idPrefix,
      targetIdPrefix,
      startSeq,
      count,
      startTimestamp,
      stepTimestamp,
      hasDigits,
    });
  }

  return { ranges, bytesRead: currentOffset - offset };
}

/**
 * Encodes VectorClock entries using VarInt-encoded client ID indices and Lamport timestamps.
 */
export function encodeVectorClock(
  vectorClock: VectorClock,
  stringTable?: string[],
): Uint8Array {
  if (!stringTable) {
    const localTable = Object.keys(vectorClock);
    const strBytes = encodeStringTable(localTable);
    const vcBytes = encodeVectorClock(vectorClock, localTable);
    return concatBuffers([strBytes, vcBytes]);
  }
  const entries = Object.entries(vectorClock);
  const parts: Uint8Array[] = [encodeVarInt(entries.length)];
  for (const [nodeId, clock] of entries) {
    let nodeIdx = stringTable.indexOf(nodeId);
    if (nodeIdx === -1) nodeIdx = 0;
    parts.push(encodeVarInt(nodeIdx));
    parts.push(encodeVarInt(clock));
  }
  return concatBuffers(parts);
}

/**
 * Decodes VectorClock entries from buffer using VarInt decoding.
 */
export function decodeVectorClock(
  buffer: Uint8Array,
  offset: number = 0,
  stringTable?: string[],
): { vectorClock: VectorClock; bytesRead: number } {
  let currentOffset = offset;
  let table = stringTable;
  if (!table) {
    const { strings, bytesRead } = decodeStringTable(buffer, currentOffset);
    table = strings;
    currentOffset += bytesRead;
  }

  const { value: count, bytesRead: countBytes } = decodeVarInt(
    buffer,
    currentOffset,
  );
  currentOffset += countBytes;

  const vectorClock: VectorClock = {};
  for (let i = 0; i < count; i++) {
    const { value: nodeIdx, bytesRead: b1 } = decodeVarInt(
      buffer,
      currentOffset,
    );
    currentOffset += b1;
    const { value: clock, bytesRead: b2 } = decodeVarInt(buffer, currentOffset);
    currentOffset += b2;

    const nodeId = table[nodeIdx] ?? `client-${nodeIdx}`;
    vectorClock[nodeId] = clock;
  }

  return { vectorClock, bytesRead: currentOffset - offset };
}

const OP_TYPE_TO_ENUM: Record<OperationType, number> = {
  DRAW_STROKE: 0,
  ADD_TEXT: 1,
  UPDATE_TEXT: 2,
  DELETE_ELEMENT: 3,
};

const ENUM_TO_OP_TYPE: OperationType[] = [
  "DRAW_STROKE",
  "ADD_TEXT",
  "UPDATE_TEXT",
  "DELETE_ELEMENT",
];

/**
 * Encodes active non-tombstone operations.
 */
export function encodeActiveElements(
  elements: CrdtOperation[],
  stringTable: string[],
): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [encodeVarInt(elements.length)];

  for (const op of elements) {
    let idIdx = stringTable.indexOf(op.id);
    if (idIdx === -1) idIdx = 0;
    let nodeIdx = stringTable.indexOf(op.nodeId);
    if (nodeIdx === -1) nodeIdx = 0;
    const typeEnum = OP_TYPE_TO_ENUM[op.type] ?? 0;

    parts.push(encodeVarInt(idIdx));
    parts.push(encodeVarInt(typeEnum));
    parts.push(encodeVarInt(nodeIdx));
    parts.push(encodeVarInt(op.timestamp));

    const vcEntries = Object.entries(op.vectorClock || {});
    parts.push(encodeVarInt(vcEntries.length));
    for (const [vcNode, vcClock] of vcEntries) {
      let vcNodeIdx = stringTable.indexOf(vcNode);
      if (vcNodeIdx === -1) vcNodeIdx = 0;
      parts.push(encodeVarInt(vcNodeIdx));
      parts.push(encodeVarInt(vcClock));
    }

    const payloadJson = JSON.stringify(op.payload || {});
    const payloadBytes = encoder.encode(payloadJson);
    parts.push(encodeVarInt(payloadBytes.length));
    parts.push(payloadBytes);
  }

  return concatBuffers(parts);
}

/**
 * Decodes active non-tombstone operations from buffer.
 */
export function decodeActiveElements(
  buffer: Uint8Array,
  offset: number = 0,
  stringTable: string[] = [],
): { elements: CrdtOperation[]; bytesRead: number } {
  const decoder = new TextDecoder();
  let currentOffset = offset;
  const { value: count, bytesRead: countBytes } = decodeVarInt(
    buffer,
    currentOffset,
  );
  currentOffset += countBytes;

  const elements: CrdtOperation[] = [];
  for (let i = 0; i < count; i++) {
    const { value: idIdx, bytesRead: b1 } = decodeVarInt(buffer, currentOffset);
    currentOffset += b1;
    const { value: typeEnum, bytesRead: b2 } = decodeVarInt(
      buffer,
      currentOffset,
    );
    currentOffset += b2;
    const { value: nodeIdx, bytesRead: b3 } = decodeVarInt(
      buffer,
      currentOffset,
    );
    currentOffset += b3;
    const { value: timestamp, bytesRead: b4 } = decodeVarInt(
      buffer,
      currentOffset,
    );
    currentOffset += b4;

    const { value: vcCount, bytesRead: b5 } = decodeVarInt(
      buffer,
      currentOffset,
    );
    currentOffset += b5;
    const vectorClock: VectorClock = {};
    for (let j = 0; j < vcCount; j++) {
      const { value: vcNodeIdx, bytesRead: vcB1 } = decodeVarInt(
        buffer,
        currentOffset,
      );
      currentOffset += vcB1;
      const { value: vcClock, bytesRead: vcB2 } = decodeVarInt(
        buffer,
        currentOffset,
      );
      currentOffset += vcB2;
      const vcNode = stringTable[vcNodeIdx] ?? `client-${vcNodeIdx}`;
      vectorClock[vcNode] = vcClock;
    }

    const { value: payloadLen, bytesRead: b6 } = decodeVarInt(
      buffer,
      currentOffset,
    );
    currentOffset += b6;
    const payloadBytes = buffer.subarray(
      currentOffset,
      currentOffset + payloadLen,
    );
    currentOffset += payloadLen;
    const payloadJson = decoder.decode(payloadBytes);
    const payload = payloadJson ? JSON.parse(payloadJson) : {};

    elements.push({
      id: stringTable[idIdx] ?? `elem-${idIdx}`,
      type: ENUM_TO_OP_TYPE[typeEnum] || "ADD_TEXT",
      nodeId: stringTable[nodeIdx] ?? `client-${nodeIdx}`,
      timestamp,
      vectorClock,
      payload,
    });
  }

  return { elements, bytesRead: currentOffset - offset };
}

/**
 * Encodes full CrdtState into a compressed binary format using VarInt and RLE.
 */
export function encodeStateBinary(state: CrdtState): Uint8Array {
  const stringSet = new Set<string>();

  for (const nodeId of Object.keys(state.vectorClock)) {
    stringSet.add(nodeId);
  }

  const allOps = Object.values(state.elements);
  const tombstones = allOps.filter((op) => op.type === "DELETE_ELEMENT");
  const activeOps = allOps.filter((op) => op.type !== "DELETE_ELEMENT");

  const tombstoneRanges = extractTombstoneRanges(tombstones);
  for (const range of tombstoneRanges) {
    stringSet.add(range.nodeId);
    stringSet.add(range.idPrefix);
    if (range.targetIdPrefix) {
      stringSet.add(range.targetIdPrefix);
    }
  }

  for (const op of activeOps) {
    stringSet.add(op.id);
    stringSet.add(op.nodeId);
    for (const vcNode of Object.keys(op.vectorClock || {})) {
      stringSet.add(vcNode);
    }
  }

  const stringTable = Array.from(stringSet);
  const strTableBytes = encodeStringTable(stringTable);
  const vcBytes = encodeVectorClock(state.vectorClock, stringTable);
  const rleBytes = encodeRleTombstones(tombstoneRanges, stringTable);
  const activeBytes = encodeActiveElements(activeOps, stringTable);

  const header = new Uint8Array([0x57, 0x53, 1]); // WS v1
  return concatBuffers([header, strTableBytes, vcBytes, rleBytes, activeBytes]);
}

/**
 * Decodes compressed binary format back into a CrdtState.
 */
export function decodeStateBinary(buffer: Uint8Array): CrdtState {
  if (buffer.length < 3) {
    throw new Error("Invalid binary CRDT payload: buffer too short");
  }
  if (buffer[0] !== 0x57 || buffer[1] !== 0x53) {
    throw new Error("Invalid binary CRDT payload: magic mismatch");
  }
  const version = buffer[2];
  if (version !== 1) {
    throw new Error(`Unsupported binary CRDT payload version: ${version}`);
  }

  let offset = 3;
  const { strings: stringTable, bytesRead: bStr } = decodeStringTable(
    buffer,
    offset,
  );
  offset += bStr;

  const { vectorClock, bytesRead: bVc } = decodeVectorClock(
    buffer,
    offset,
    stringTable,
  );
  offset += bVc;

  const { ranges: tombstoneRanges, bytesRead: bRle } = decodeRleTombstones(
    buffer,
    offset,
    stringTable,
  );
  offset += bRle;

  const { elements: activeElements, bytesRead: bAct } = decodeActiveElements(
    buffer,
    offset,
    stringTable,
  );
  offset += bAct;

  const tombstoneOps = expandTombstoneRanges(tombstoneRanges);
  const elements: Record<string, CrdtOperation> = {};

  for (const op of tombstoneOps) {
    elements[op.id] = op;
  }
  for (const op of activeElements) {
    elements[op.id] = op;
  }

  return { elements, vectorClock };
}
