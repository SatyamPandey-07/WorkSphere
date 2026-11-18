/**
 * @file FECReedSolomon.ts
 * @description Real-time zero-loss Reed-Solomon Forward Error Correction (FEC) over Galois Field GF(2^8).
 * Generates systematic parity shards from data shards and reconstructs lost WebRTC audio/video packets
 * via Gaussian elimination matrix inversion over GF(2^8).
 */

/**
 * Primitive polynomial for GF(2^8): x^8 + x^4 + x^3 + x^2 + 1 (0x11d = 285).
 */
export const GF256_PRIMITIVE = 0x11d;

/**
 * Precomputed log and antilog tables for O(1) Galois Field GF(2^8) arithmetic.
 */
export class GF256 {
  public static readonly expTable: Uint8Array = new Uint8Array(512);
  public static readonly logTable: Uint8Array = new Uint8Array(256);

  private static initialized = false;

  public static init(): void {
    if (GF256.initialized) return;

    let x = 1;
    for (let i = 0; i < 255; i++) {
      GF256.expTable[i] = x;
      GF256.expTable[i + 255] = x;
      GF256.logTable[x] = i;
      x <<= 1;
      if (x & 0x100) {
        x ^= GF256_PRIMITIVE;
      }
    }
    GF256.initialized = true;
  }

  public static add(a: number, b: number): number {
    return a ^ b;
  }

  public static sub(a: number, b: number): number {
    return a ^ b;
  }

  public static mul(a: number, b: number): number {
    if (a === 0 || b === 0) return 0;
    GF256.init();
    return GF256.expTable[GF256.logTable[a] + GF256.logTable[b]];
  }

  public static div(a: number, b: number): number {
    if (b === 0) throw new Error('GF256: Division by zero');
    if (a === 0) return 0;
    GF256.init();
    return GF256.expTable[(GF256.logTable[a] - GF256.logTable[b] + 255) % 255];
  }

  public static inv(val: number): number {
    if (val === 0) throw new Error('GF256: Cannot invert zero');
    GF256.init();
    return GF256.expTable[255 - GF256.logTable[val]];
  }
}

// Ensure tables are initialized at module load
GF256.init();

/**
 * Inverts an N x N matrix over GF(2^8) using Gaussian elimination with partial pivoting.
 */
export function invertMatrixGF256(matrix: number[][]): number[][] {
  const n = matrix.length;
  // Augmented matrix [A | I]
  const aug: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(2 * n).fill(0);
    for (let j = 0; j < n; j++) {
      row[j] = matrix[i][j];
    }
    row[n + i] = 1;
    aug.push(row);
  }

  for (let c = 0; c < n; c++) {
    // Pivot search
    let pivotRow = -1;
    for (let r = c; r < n; r++) {
      if (aug[r][c] !== 0) {
        pivotRow = r;
        break;
      }
    }

    if (pivotRow === -1) {
      throw new Error('invertMatrixGF256: Matrix is singular and cannot be inverted');
    }

    // Swap pivot row
    if (pivotRow !== c) {
      const temp = aug[c];
      aug[c] = aug[pivotRow];
      aug[pivotRow] = temp;
    }

    // Scale pivot row so leading coefficient is 1
    const pivotVal = aug[c][c];
    if (pivotVal !== 1) {
      const invPivot = GF256.inv(pivotVal);
      for (let j = 0; j < 2 * n; j++) {
        aug[c][j] = GF256.mul(aug[c][j], invPivot);
      }
    }

    // Eliminate column in other rows
    for (let r = 0; r < n; r++) {
      if (r !== c && aug[r][c] !== 0) {
        const factor = aug[r][c];
        for (let j = 0; j < 2 * n; j++) {
          aug[r][j] = GF256.sub(aug[r][j], GF256.mul(factor, aug[c][j]));
        }
      }
    }
  }

  // Extract inverse from right half
  const inv: number[][] = [];
  for (let i = 0; i < n; i++) {
    inv.push(aug[i].slice(n));
  }
  return inv;
}

/**
 * FEC Encoded Shard packet structure.
 */
export interface FECShard {
  readonly index: number; // 0..K-1 for data, K..N-1 for parity
  readonly isParity: boolean;
  readonly data: Uint8Array;
}

/**
 * Systematic Reed-Solomon Erasure Coding Engine.
 */
export class FECReedSolomon {
  public readonly dataShardsCount: number; // K
  public readonly parityShardsCount: number; // M
  public readonly totalShardsCount: number; // N = K + M

  private readonly generatorMatrix: number[][]; // N x K

  constructor(dataShards: number, parityShards: number) {
    if (dataShards < 1 || parityShards < 1) {
      throw new Error('FECReedSolomon: Data and parity shard counts must be at least 1');
    }
    if (dataShards + parityShards > 255) {
      throw new Error('FECReedSolomon: Total shards cannot exceed 255 in GF(2^8)');
    }

    this.dataShardsCount = dataShards;
    this.parityShardsCount = parityShards;
    this.totalShardsCount = dataShards + parityShards;

    this.generatorMatrix = this.buildGeneratorMatrix();
  }

  /**
   * Encodes K systematic data shards into N total shards (K data + M parity).
   */
  public encode(shards: Uint8Array[]): FECShard[] {
    const k = this.dataShardsCount;
    const m = this.parityShardsCount;

    if (shards.length !== k) {
      throw new Error(`encode: Expected ${k} data shards, received ${shards.length}`);
    }

    const shardSize = shards[0].length;
    for (let i = 1; i < k; i++) {
      if (shards[i].length !== shardSize) {
        throw new Error('encode: All data shards must have identical byte length');
      }
    }

    const result: FECShard[] = [];

    // First K shards are systematic (verbatim copies)
    for (let i = 0; i < k; i++) {
      result.push({
        index: i,
        isParity: false,
        data: new Uint8Array(shards[i]),
      });
    }

    // Next M shards are parity: P_i = sum_j (G[K + i][j] * D_j)
    for (let p = 0; p < m; p++) {
      const parityBuf = new Uint8Array(shardSize);
      const rowIdx = k + p;

      for (let j = 0; j < k; j++) {
        const coeff = this.generatorMatrix[rowIdx][j];
        if (coeff === 0) continue;
        const dataBuf = shards[j];
        for (let b = 0; b < shardSize; b++) {
          parityBuf[b] = GF256.add(parityBuf[b], GF256.mul(coeff, dataBuf[b]));
        }
      }

      result.push({
        index: k + p,
        isParity: true,
        data: parityBuf,
      });
    }

    return result;
  }

  /**
   * Decodes and reconstructs missing data shards from any K surviving shards out of N.
   */
  public decode(survivingShards: FECShard[]): Uint8Array[] {
    const k = this.dataShardsCount;

    if (survivingShards.length < k) {
      throw new Error(`decode: Need at least ${k} surviving shards to recover, received ${survivingShards.length}`);
    }

    // Check if all K systematic data shards are present
    const dataShardsMap = new Map<number, Uint8Array>();
    for (const shard of survivingShards) {
      if (!shard.isParity && shard.index < k) {
        dataShardsMap.set(shard.index, shard.data);
      }
    }

    if (dataShardsMap.size === k) {
      // Fast path: no lost data shards
      const recovered: Uint8Array[] = [];
      for (let i = 0; i < k; i++) {
        recovered.push(dataShardsMap.get(i)!);
      }
      return recovered;
    }

    // Pick first K available shards
    const activeSubShards = survivingShards.slice(0, k);
    const shardSize = activeSubShards[0].data.length;

    // Submatrix of generator matrix corresponding to active shards
    const subMatrix: number[][] = [];
    for (let i = 0; i < k; i++) {
      const rowIndex = activeSubShards[i].index;
      subMatrix.push([...this.generatorMatrix[rowIndex]]);
    }

    // Invert K x K submatrix over GF(2^8)
    const invMatrix = invertMatrixGF256(subMatrix);

    // Reconstruct original data shards: D = invMatrix * activeSubShards
    const reconstructed: Uint8Array[] = [];
    for (let r = 0; r < k; r++) {
      const outBuf = new Uint8Array(shardSize);
      for (let c = 0; c < k; c++) {
        const coeff = invMatrix[r][c];
        if (coeff === 0) continue;
        const shardData = activeSubShards[c].data;
        for (let b = 0; b < shardSize; b++) {
          outBuf[b] = GF256.add(outBuf[b], GF256.mul(coeff, shardData[b]));
        }
      }
      reconstructed.push(outBuf);
    }

    return reconstructed;
  }

  /**
   * Convenience utility to slice raw buffer into K shards, pad with zeros, and encode.
   */
  public encodePayload(payload: Uint8Array): { shards: FECShard[]; originalLength: number } {
    const k = this.dataShardsCount;
    const originalLength = payload.length;
    const shardSize = Math.ceil(originalLength / k);

    const dataShards: Uint8Array[] = [];
    for (let i = 0; i < k; i++) {
      const shard = new Uint8Array(shardSize);
      const start = i * shardSize;
      const end = Math.min(start + shardSize, originalLength);
      if (start < originalLength) {
        shard.set(payload.subarray(start, end), 0);
      }
      dataShards.push(shard);
    }

    return {
      shards: this.encode(dataShards),
      originalLength,
    };
  }

  /**
   * Convenience utility to reconstruct raw buffer from surviving shards.
   */
  public decodePayload(survivingShards: FECShard[], originalLength: number): Uint8Array {
    const dataShards = this.decode(survivingShards);
    const full = new Uint8Array(dataShards.length * dataShards[0].length);
    for (let i = 0; i < dataShards.length; i++) {
      full.set(dataShards[i], i * dataShards[0].length);
    }
    return full.subarray(0, originalLength);
  }

  private buildGeneratorMatrix(): number[][] {
    const k = this.dataShardsCount;
    const m = this.parityShardsCount;
    const n = this.totalShardsCount;

    const matrix: number[][] = [];

    // Top K rows: Identity matrix
    for (let r = 0; r < k; r++) {
      const row = new Array<number>(k).fill(0);
      row[r] = 1;
      matrix.push(row);
    }

    // Bottom M rows: Cauchy matrix over GF(2^8)
    // C[i][j] = 1 / (X_i ^ Y_j) where X and Y are disjoint non-zero sets
    for (let i = 0; i < m; i++) {
      const row = new Array<number>(k).fill(0);
      const x = k + i + 1;
      for (let j = 0; j < k; j++) {
        const y = j + 1;
        const denom = GF256.add(x, y);
        row[j] = GF256.inv(denom);
      }
      matrix.push(row);
    }

    return matrix;
  }
}
