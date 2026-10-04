import { HNSWIndex } from "./hnsw";
import { HnswConfig } from "./types";

const MAGIC = [0x48, 0x4e, 0x53, 0x57];
const FORMAT_VERSION = 1;
const HEADER_SIZE = 16;

export interface QuantizedVector {
  values: Uint8Array;
  scale: number;
  offset: number;
}

interface SerializedMetadata {
  config: HnswConfig;
  maxLevel: number;
  entryPoint: string | null;
  ids: string[];
}

export function quantizeVector(vector: number[]): QuantizedVector {
  if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error("HNSW vectors must contain finite coordinates");
  }

  let min = vector[0];
  let max = vector[0];
  for (const value of vector) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  const offset = min;
  const scale = max === min ? 0 : (max - min) / 255;
  const values = new Uint8Array(vector.length);
  if (scale !== 0) {
    for (let i = 0; i < vector.length; i++) {
      values[i] = Math.round((vector[i] - offset) / scale);
    }
  }

  return { values, scale, offset };
}

export function dequantizeVector(vector: QuantizedVector): number[] {
  return Array.from(
    vector.values,
    (value) => vector.offset + value * vector.scale,
  );
}

export function cosineDistanceADC(
  query: number[],
  quantized: QuantizedVector,
): number {
  if (query.length !== quantized.values.length) {
    throw new Error("Query and quantized vector dimensions must match");
  }

  let dot = 0;
  let queryNorm = 0;
  let vectorNorm = 0;
  for (let i = 0; i < query.length; i++) {
    const queryValue = query[i];
    const vectorValue = quantized.offset + quantized.values[i] * quantized.scale;
    dot += queryValue * vectorValue;
    queryNorm += queryValue * queryValue;
    vectorNorm += vectorValue * vectorValue;
  }

  const denominator = Math.sqrt(queryNorm) * Math.sqrt(vectorNorm);
  return denominator === 0 ? 1 : 1 - dot / denominator;
}

export function serializeHnswIndex(index: HNSWIndex): ArrayBuffer {
  const graph = index.toJSON();
  const nodes = index.getAllNodes();
  const ids = Array.from(nodes.keys());
  const idToIndex = new Map(ids.map((id, nodeIndex) => [id, nodeIndex]));
  const dimension = graph.config.dim;

  if (!Number.isInteger(dimension) || dimension <= 0 || dimension > 0xffff) {
    throw new Error("HNSW vector dimension must be between 1 and 65535");
  }

  const metadata: SerializedMetadata = {
    config: graph.config,
    maxLevel: graph.maxLevel,
    entryPoint: graph.entryPoint,
    ids,
  };
  const encodedMetadata = new TextEncoder().encode(JSON.stringify(metadata));
  const nodeRecords: Uint8Array[] = [];
  let recordsLength = 0;

  for (const node of nodes.values()) {
    if (node.vector.length !== dimension) {
      throw new Error(`HNSW node ${node.id} has an unexpected vector dimension`);
    }
    const quantized = quantizeVector(node.vector);
    let recordLength = 2 + 8 + dimension;
    for (const [layer, neighborIds] of node.neighbors) {
      if (!Number.isInteger(layer) || layer < 0 || layer > 0xff) {
        throw new Error("HNSW layer must be between 0 and 255");
      }
      if (neighborIds.length > 0xffff) {
        throw new Error("HNSW layer has too many neighbors to serialize");
      }
      recordLength += 3 + neighborIds.length * 4;
    }

    const record = new Uint8Array(recordLength);
    const view = new DataView(record.buffer);
    let offset = 0;
    view.setUint8(offset++, node.level);
    view.setUint8(offset++, node.neighbors.size);
    for (const [layer, neighborIds] of node.neighbors) {
      view.setUint8(offset++, layer);
      view.setUint16(offset, neighborIds.length, true);
      offset += 2;
      for (const neighborId of neighborIds) {
        const neighborIndex = idToIndex.get(neighborId);
        if (neighborIndex === undefined) {
          throw new Error(`HNSW node ${node.id} references a missing neighbor`);
        }
        view.setUint32(offset, neighborIndex, true);
        offset += 4;
      }
    }
    view.setFloat32(offset, quantized.offset, true);
    offset += 4;
    view.setFloat32(offset, quantized.scale, true);
    offset += 4;
    record.set(quantized.values, offset);
    nodeRecords.push(record);
    recordsLength += record.length;
  }

  const buffer = new ArrayBuffer(
    HEADER_SIZE + encodedMetadata.length + recordsLength,
  );
  const bytes = new Uint8Array(buffer);
  bytes.set(MAGIC, 0);
  const header = new DataView(buffer);
  header.setUint16(4, FORMAT_VERSION, true);
  header.setUint16(6, dimension, true);
  header.setUint32(8, ids.length, true);
  header.setUint32(12, encodedMetadata.length, true);
  bytes.set(encodedMetadata, HEADER_SIZE);

  let cursor = HEADER_SIZE + encodedMetadata.length;
  for (const record of nodeRecords) {
    bytes.set(record, cursor);
    cursor += record.length;
  }

  return buffer;
}

export function deserializeHnswIndex(buffer: ArrayBuffer): HNSWIndex {
  if (buffer.byteLength < HEADER_SIZE) {
    throw new Error("Invalid HNSW data: header is incomplete");
  }

  const bytes = new Uint8Array(buffer);
  if (!MAGIC.every((value, index) => bytes[index] === value)) {
    throw new Error("Invalid HNSW data: signature does not match");
  }

  const header = new DataView(buffer);
  if (header.getUint16(4, true) !== FORMAT_VERSION) {
    throw new Error("Unsupported HNSW serialization version");
  }

  const dimension = header.getUint16(6, true);
  const nodeCount = header.getUint32(8, true);
  const metadataLength = header.getUint32(12, true);
  const metadataStart = HEADER_SIZE;
  const recordsStart = metadataStart + metadataLength;
  if (dimension === 0 || recordsStart > buffer.byteLength) {
    throw new Error("Invalid HNSW data: header lengths are out of bounds");
  }

  const metadata = JSON.parse(
    new TextDecoder().decode(bytes.subarray(metadataStart, recordsStart)),
  ) as SerializedMetadata;
  if (
    metadata.ids.length !== nodeCount ||
    metadata.config.dim !== dimension ||
    new Set(metadata.ids).size !== nodeCount
  ) {
    throw new Error("Invalid HNSW data: metadata does not match header");
  }

  const nodes: Record<
    string,
    { vector: number[]; level: number; neighbors: Record<number, string[]> }
  > = {};
  let cursor = recordsStart;
  for (const id of metadata.ids) {
    if (cursor + 2 > buffer.byteLength) {
      throw new Error("Invalid HNSW data: node record is incomplete");
    }
    const level = header.getUint8(cursor++);
    const layerCount = header.getUint8(cursor++);
    const neighbors: Record<number, string[]> = {};

    for (let layerIndex = 0; layerIndex < layerCount; layerIndex++) {
      if (cursor + 3 > buffer.byteLength) {
        throw new Error("Invalid HNSW data: edge record is incomplete");
      }
      const layer = header.getUint8(cursor++);
      const neighborCount = header.getUint16(cursor, true);
      cursor += 2;
      const edgeBytes = neighborCount * 4;
      if (cursor + edgeBytes > buffer.byteLength) {
        throw new Error("Invalid HNSW data: edge list is incomplete");
      }
      const neighborIds: string[] = [];
      for (let edgeIndex = 0; edgeIndex < neighborCount; edgeIndex++) {
        const neighborIndex = header.getUint32(cursor, true);
        cursor += 4;
        const neighborId = metadata.ids[neighborIndex];
        if (neighborId === undefined) {
          throw new Error("Invalid HNSW data: edge references an unknown node");
        }
        neighborIds.push(neighborId);
      }
      neighbors[layer] = neighborIds;
    }

    if (cursor + 8 + dimension > buffer.byteLength) {
      throw new Error("Invalid HNSW data: vector record is incomplete");
    }
    const offset = header.getFloat32(cursor, true);
    cursor += 4;
    const scale = header.getFloat32(cursor, true);
    cursor += 4;
    if (!Number.isFinite(offset) || !Number.isFinite(scale) || scale < 0) {
      throw new Error("Invalid HNSW data: invalid quantization header");
    }
    const vector: number[] = [];
    for (let vectorIndex = 0; vectorIndex < dimension; vectorIndex++) {
      vector.push(offset + bytes[cursor++] * scale);
    }
    nodes[id] = { vector, level, neighbors };
  }

  if (cursor !== buffer.byteLength) {
    throw new Error("Invalid HNSW data: unexpected trailing bytes");
  }

  return HNSWIndex.fromJSON({
    config: metadata.config,
    maxLevel: metadata.maxLevel,
    entryPoint: metadata.entryPoint,
    nodes,
  });
}