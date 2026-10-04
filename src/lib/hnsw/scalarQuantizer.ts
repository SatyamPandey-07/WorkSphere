/**
 * Scalar Quantization (SQ8) & Asymmetric Distance Computation (ADC) Engine
 * for WorkSphere HNSW Vector Indexing
 *
 * Implements:
 * 1. 8-bit Uniform Min-Max Scalar Quantization (75% memory reduction: 4 bytes -> 1 byte per dimension).
 * 2. Asymmetric Distance Computation (ADC) for Cosine and Euclidean (L2) distance without dequantization.
 * 3. Fast symmetric distance estimation for quantized node-to-node graph construction.
 * 4. Signal-to-Quantization-Noise Ratio (SQNR) and Mean Squared Error (MSE) quality metrics.
 * 5. Compact binary serialization and deserialization for IndexedDB client storage.
 * 6. High-level QuantizedVectorStore with top-k ranking and recall evaluation against exact float vectors.
 */

export interface QuantizedVector {
  id: string;
  data: Uint8Array;
  min: number;
  max: number;
  norm: number; // L2 norm of original float vector
  sumQ: number; // Sum of quantized uint8 values for fast symmetric inner products
}

export interface AsymmetricQueryContext {
  query: Float32Array;
  queryNorm: number;
  querySum: number;
  queryNormSq: number;
}

export interface QuantizationConfig {
  dim: number;
  clipOutliers?: boolean;
  outlierPercentile?: number; // e.g. 0.999
}

export interface MemoryStats {
  vectorCount: number;
  dimension: number;
  rawFloat32Bytes: number;
  quantizedBytes: number;
  bytesSaved: number;
  compressionRatio: number; // typically ~4.0x
}

export interface SearchResultItem {
  id: string;
  distance: number;
}

/**
 * Quantizes an uncompressed floating point vector into an 8-bit quantized vector (SQ8).
 *
 * @param vector Original vector as Float32Array or number[]
 * @param id Unique identifier for the vector
 * @returns QuantizedVector with uint8 data and linear transformation parameters
 */
export function quantizeVector(
  vector: number[] | Float32Array,
  id = "",
): QuantizedVector {
  const dim = vector.length;
  if (dim === 0) {
    return {
      id,
      data: new Uint8Array(0),
      min: 0,
      max: 0,
      norm: 0,
      sumQ: 0,
    };
  }

  let min = vector[0];
  let max = vector[0];
  let normSq = 0;

  for (let i = 0; i < dim; i++) {
    const val = vector[i];
    if (val < min) min = val;
    if (val > max) max = val;
    normSq += val * val;
  }

  const norm = Math.sqrt(normSq);
  const data = new Uint8Array(dim);
  let sumQ = 0;

  const range = max - min;
  if (range <= 1e-12) {
    // Constant vector: all map to 128
    data.fill(128);
    sumQ = 128 * dim;
  } else {
    const scale = 255.0 / range;
    for (let i = 0; i < dim; i++) {
      const q = Math.max(0, Math.min(255, Math.round((vector[i] - min) * scale)));
      data[i] = q;
      sumQ += q;
    }
  }

  return {
    id,
    data,
    min,
    max,
    norm,
    sumQ,
  };
}

/**
 * Reconstructs a Float32Array approximation from a QuantizedVector.
 *
 * @param qv QuantizedVector
 * @returns Dequantized Float32Array
 */
export function dequantizeVector(qv: QuantizedVector): Float32Array {
  const dim = qv.data.length;
  const reconstructed = new Float32Array(dim);

  const range = qv.max - qv.min;
  if (range <= 1e-12) {
    reconstructed.fill(qv.min);
    return reconstructed;
  }

  const step = range / 255.0;
  for (let i = 0; i < dim; i++) {
    reconstructed[i] = qv.min + qv.data[i] * step;
  }

  return reconstructed;
}

/**
 * Computes reconstruction metrics (MSE and SQNR in dB) between original and quantized vectors.
 */
export function evaluateQuantizationQuality(
  original: number[] | Float32Array,
  quantized: QuantizedVector,
): { mse: number; sqnrDb: number } {
  const dim = original.length;
  if (dim === 0) return { mse: 0, sqnrDb: Infinity };

  const rec = dequantizeVector(quantized);
  let errorEnergy = 0;
  let signalEnergy = 0;

  for (let i = 0; i < dim; i++) {
    const diff = original[i] - rec[i];
    errorEnergy += diff * diff;
    signalEnergy += original[i] * original[i];
  }

  const mse = errorEnergy / dim;
  const sqnrDb =
    errorEnergy > 0 && signalEnergy > 0
      ? 10 * Math.log10(signalEnergy / errorEnergy)
      : Infinity;

  return { mse, sqnrDb };
}

/**
 * Precomputes linear transformation context for the query vector to accelerate
 * Asymmetric Distance Computation across thousands of quantized vectors.
 *
 * @param query Query vector as Float32Array or number[]
 */
export function createAsymmetricQueryContext(
  query: number[] | Float32Array,
): AsymmetricQueryContext {
  const dim = query.length;
  const qFloat = query instanceof Float32Array ? query : new Float32Array(query);

  let querySum = 0;
  let queryNormSq = 0;

  for (let i = 0; i < dim; i++) {
    const val = qFloat[i];
    querySum += val;
    queryNormSq += val * val;
  }

  return {
    query: qFloat,
    queryNorm: Math.sqrt(queryNormSq),
    querySum,
    queryNormSq,
  };
}

/**
 * Calculates Asymmetric Cosine Distance directly between an unquantized query
 * and an 8-bit quantized vector:
 *
 * Distance = 1.0 - (DotProduct / (QueryNorm * VectorNorm))
 *
 * Uses linear parameter factorization:
 * DotProduct = min * sum(Query) + (range / 255) * sum(Query_i * Quantized_i)
 */
export function computeAsymmetricCosineDistance(
  ctx: AsymmetricQueryContext,
  qv: QuantizedVector,
): number {
  if (ctx.queryNorm === 0 || qv.norm === 0) {
    return 1.0;
  }

  const dim = qv.data.length;
  const range = qv.max - qv.min;

  let dotProduct: number;
  if (range <= 1e-12) {
    dotProduct = qv.min * ctx.querySum;
  } else {
    const step = range / 255.0;
    const q = ctx.query;
    const d = qv.data;

    let intDot = 0;
    for (let i = 0; i < dim; i++) {
      intDot += q[i] * d[i];
    }

    dotProduct = qv.min * ctx.querySum + step * intDot;
  }

  const denom = ctx.queryNorm * qv.norm;
  const similarity = denom > 0 ? dotProduct / denom : 0;
  return Math.max(0, Math.min(2, 1 - similarity));
}

/**
 * Calculates Asymmetric Euclidean (L2) Distance using precomputed norms:
 *
 * ||Q - X||^2 = ||Q||^2 + ||X||^2 - 2 * <Q, X>
 */
export function computeAsymmetricEuclideanDistance(
  ctx: AsymmetricQueryContext,
  qv: QuantizedVector,
): number {
  const dim = qv.data.length;
  const range = qv.max - qv.min;

  let dotProduct: number;
  if (range <= 1e-12) {
    dotProduct = qv.min * ctx.querySum;
  } else {
    const step = range / 255.0;
    const q = ctx.query;
    const d = qv.data;

    let intDot = 0;
    for (let i = 0; i < dim; i++) {
      intDot += q[i] * d[i];
    }
    dotProduct = qv.min * ctx.querySum + step * intDot;
  }

  const vectorNormSq = qv.norm * qv.norm;
  const distSq = ctx.queryNormSq + vectorNormSq - 2 * dotProduct;
  return Math.sqrt(Math.max(0, distSq));
}

/**
 * Computes fast symmetric cosine distance between two quantized vectors.
 */
export function computeSymmetricCosineDistance(
  a: QuantizedVector,
  b: QuantizedVector,
): number {
  if (a.norm === 0 || b.norm === 0) return 1.0;

  const dim = a.data.length;
  const stepA = (a.max - a.min) / 255.0;
  const stepB = (b.max - b.min) / 255.0;

  let dot = 0;
  const dA = a.data;
  const dB = b.data;

  // sum( (minA + stepA * a_i) * (minB + stepB * b_i) )
  // = dim * minA * minB + minA * stepB * sumB + minB * stepA * sumA + stepA * stepB * sum(a_i * b_i)
  let intDot = 0;
  for (let i = 0; i < dim; i++) {
    intDot += dA[i] * dB[i];
  }

  dot =
    dim * a.min * b.min +
    a.min * stepB * b.sumQ +
    b.min * stepA * a.sumQ +
    stepA * stepB * intDot;

  const denom = a.norm * b.norm;
  const similarity = denom > 0 ? dot / denom : 0;
  return Math.max(0, Math.min(2, 1 - similarity));
}

/**
 * Compact binary serialization for IndexedDB / network transfer.
 *
 * Header:
 * - Magic: 'SQ08' (4 bytes)
 * - Dimension: uint32 (4 bytes)
 * - Count: uint32 (4 bytes)
 *
 * For each vector:
 * - ID length: uint16 (2 bytes)
 * - ID: utf-8 bytes
 * - min: float32 (4 bytes)
 * - max: float32 (4 bytes)
 * - norm: float32 (4 bytes)
 * - sumQ: uint32 (4 bytes)
 * - data: uint8 array (dim bytes)
 */
export function serializeQuantizedVectors(vectors: QuantizedVector[]): Uint8Array {
  const encoder = new TextEncoder();
  const count = vectors.length;
  const dim = count > 0 ? vectors[0].data.length : 0;

  let totalSize = 12; // header
  const encodedIds: Uint8Array[] = new Array(count);

  for (let i = 0; i < count; i++) {
    const idBytes = encoder.encode(vectors[i].id);
    encodedIds[i] = idBytes;
    totalSize += 2 + idBytes.length + 16 + dim;
  }

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const uint8 = new Uint8Array(buffer);

  // Magic 'SQ08'
  uint8[0] = 0x53; // 'S'
  uint8[1] = 0x51; // 'Q'
  uint8[2] = 0x30; // '0'
  uint8[3] = 0x38; // '8'

  view.setUint32(4, dim, true);
  view.setUint32(8, count, true);

  let offset = 12;
  for (let i = 0; i < count; i++) {
    const v = vectors[i];
    const idBytes = encodedIds[i];

    view.setUint16(offset, idBytes.length, true);
    offset += 2;

    uint8.set(idBytes, offset);
    offset += idBytes.length;

    view.setFloat32(offset, v.min, true);
    offset += 4;
    view.setFloat32(offset, v.max, true);
    offset += 4;
    view.setFloat32(offset, v.norm, true);
    offset += 4;
    view.setUint32(offset, v.sumQ, true);
    offset += 4;

    uint8.set(v.data, offset);
    offset += dim;
  }

  return uint8;
}

/**
 * Deserializes compact binary format back to QuantizedVector array.
 */
export function deserializeQuantizedVectors(buffer: Uint8Array): QuantizedVector[] {
  if (buffer.length < 12) {
    throw new Error("Invalid quantized vector buffer: insufficient header bytes.");
  }

  // Verify magic
  if (
    buffer[0] !== 0x53 ||
    buffer[1] !== 0x51 ||
    buffer[2] !== 0x30 ||
    buffer[3] !== 0x38
  ) {
    throw new Error("Invalid quantized vector buffer: magic mismatch.");
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const dim = view.getUint32(4, true);
  const count = view.getUint32(8, true);

  const decoder = new TextDecoder();
  const vectors: QuantizedVector[] = new Array(count);
  let offset = 12;

  for (let i = 0; i < count; i++) {
    if (offset + 2 > buffer.length) {
      throw new Error(`Buffer overrun while reading vector index ${i}`);
    }

    const idLen = view.getUint16(offset, true);
    offset += 2;

    const idBytes = buffer.subarray(offset, offset + idLen);
    const id = decoder.decode(idBytes);
    offset += idLen;

    const min = view.getFloat32(offset, true);
    offset += 4;
    const max = view.getFloat32(offset, true);
    offset += 4;
    const norm = view.getFloat32(offset, true);
    offset += 4;
    const sumQ = view.getUint32(offset, true);
    offset += 4;

    const data = new Uint8Array(dim);
    data.set(buffer.subarray(offset, offset + dim));
    offset += dim;

    vectors[i] = {
      id,
      data,
      min,
      max,
      norm,
      sumQ,
    };
  }

  return vectors;
}

/**
 * In-Memory Quantized Vector Store with Asymmetric Top-K Distance Ranking
 */
export class QuantizedVectorStore {
  private vectors: Map<string, QuantizedVector> = new Map();
  private dimension: number;

  constructor(dimension: number) {
    this.dimension = dimension;
  }

  /**
   * Adds or updates a vector in the store.
   */
  add(id: string, vector: number[] | Float32Array): QuantizedVector {
    if (vector.length !== this.dimension) {
      throw new Error(
        `Dimension mismatch: expected ${this.dimension}, received ${vector.length}`,
      );
    }
    const qv = quantizeVector(vector, id);
    this.vectors.set(id, qv);
    return qv;
  }

  /**
   * Batch adds multiple vectors.
   */
  addBatch(
    items: Array<{ id: string; vector: number[] | Float32Array }>,
  ): QuantizedVector[] {
    const results: QuantizedVector[] = new Array(items.length);
    for (let i = 0; i < items.length; i++) {
      results[i] = this.add(items[i].id, items[i].vector);
    }
    return results;
  }

  /**
   * Retrieves a quantized vector by ID.
   */
  get(id: string): QuantizedVector | undefined {
    return this.vectors.get(id);
  }

  /**
   * Checks if an ID exists.
   */
  has(id: string): boolean {
    return this.vectors.has(id);
  }

  /**
   * Removes a vector by ID.
   */
  delete(id: string): boolean {
    return this.vectors.delete(id);
  }

  /**
   * Total number of stored vectors.
   */
  size(): number {
    return this.vectors.size;
  }

  /**
   * Searches the store for the top-k nearest neighbors using Asymmetric Distance Computation.
   *
   * @param query Unquantized query vector
   * @param k Number of results to return
   * @param metric Distance metric ("cosine" | "euclidean")
   */
  search(
    query: number[] | Float32Array,
    k = 10,
    metric: "cosine" | "euclidean" = "cosine",
  ): SearchResultItem[] {
    if (query.length !== this.dimension) {
      throw new Error(
        `Dimension mismatch: expected ${this.dimension}, received ${query.length}`,
      );
    }

    const ctx = createAsymmetricQueryContext(query);
    const results: SearchResultItem[] = [];

    const isCosine = metric === "cosine";
    for (const qv of this.vectors.values()) {
      const distance = isCosine
        ? computeAsymmetricCosineDistance(ctx, qv)
        : computeAsymmetricEuclideanDistance(ctx, qv);

      results.push({ id: qv.id, distance });
    }

    // Sort ascending by distance
    results.sort((a, b) => a.distance - b.distance);
    return results.slice(0, Math.max(1, k));
  }

  /**
   * Computes recall@k of the quantized search against exact unquantized ground truth.
   */
  evaluateRecall(
    exactResults: SearchResultItem[],
    quantizedResults: SearchResultItem[],
  ): number {
    if (exactResults.length === 0 || quantizedResults.length === 0) return 1.0;

    const exactIds = new Set(exactResults.map((r) => r.id));
    let matches = 0;

    for (const r of quantizedResults) {
      if (exactIds.has(r.id)) {
        matches++;
      }
    }

    return matches / exactResults.length;
  }

  /**
   * Returns current RAM memory stats comparing raw Float32 storage vs SQ8.
   */
  getMemoryStats(): MemoryStats {
    const count = this.vectors.size;
    const rawFloat32Bytes = count * this.dimension * 4;
    // Quantized data: count * dim * 1 byte + 16 bytes metadata per vector
    const quantizedBytes = count * (this.dimension + 16);
    const bytesSaved = Math.max(0, rawFloat32Bytes - quantizedBytes);
    const compressionRatio =
      quantizedBytes > 0
        ? Math.round((rawFloat32Bytes / quantizedBytes) * 100) / 100
        : 4.0;

    return {
      vectorCount: count,
      dimension: this.dimension,
      rawFloat32Bytes,
      quantizedBytes,
      bytesSaved,
      compressionRatio,
    };
  }

  /**
   * Exports all vectors to compact binary format.
   */
  exportBinary(): Uint8Array {
    return serializeQuantizedVectors(Array.from(this.vectors.values()));
  }

  /**
   * Imports vectors from compact binary format.
   */
  importBinary(buffer: Uint8Array): void {
    const imported = deserializeQuantizedVectors(buffer);
    for (const qv of imported) {
      if (qv.data.length !== this.dimension) {
        throw new Error(
          `Dimension mismatch on import: expected ${this.dimension}, found ${qv.data.length}`,
        );
      }
      this.vectors.set(qv.id, qv);
    }
  }

  /**
   * Clears the store.
   */
  clear(): void {
    this.vectors.clear();
  }
}
