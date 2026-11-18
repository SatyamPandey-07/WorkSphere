import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Committed Matrix-Vector Product Prover (Freivalds-Folded Pedersen ZKP).
 *
 * Proves in zero knowledge that a public matrix M (rows x cols) multiplied by a secretly
 * committed witness vector x (committed entry-wise as C_x[j] = g^{x_j} * h^{rx_j}) equals
 * a secretly committed output vector y (C_y[i] = g^{y_i} * h^{ry_i}) — i.e. M * x == y mod Q:
 *  - Derives a Fiat-Shamir Freivalds challenge vector u = (1, alpha, alpha^2, ..., alpha^{rows-1})
 *  - Verifier collapses the entire rows x cols linear system into ONE scalar commitment equation:
 *      prod_{j=0}^{cols-1} C_x[j]^{(u^T M)_j}  vs  prod_{i=0}^{rows-1} C_y[i]^{u_i}
 *  - Since u^T * (M * x) == u^T * y iff (u^T M) * x == u^T * y, their ratio is a pure h-power
 *    h^{sum (u^T M)_j rx_j - sum u_i ry_i}, proven via a single constant-size Schnorr opening!
 */

export const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
export const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
export const BASE_G = 4n;

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = ((base % mod) + mod) % mod;
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return result;
}

function modScalar(v: bigint): bigint {
  return ((v % SUBGROUP_Q) + SUBGROUP_Q) % SUBGROUP_Q;
}

function randomScalar(): bigint {
  const bytes = randomBytes(16);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return (v % (SUBGROUP_Q - 2n)) + 1n;
}

function hashToScalar(...parts: string[]): bigint {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return modScalar(BigInt('0x' + h.digest('hex').slice(0, 32)));
}

function deriveH(): bigint {
  const hex = createHash('sha256').update('ZK-COMMIT-MATRIX-FREIVALDS-H-V1').digest('hex');
  const raw = (BigInt('0x' + hex.slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const BASE_H = deriveH();

export interface CommittedVector {
  values: bigint[];
  blindings: bigint[];
  commitments: bigint[];
}

export interface MatrixVectorProductProof {
  rows: number;
  cols: number;
  matrix: bigint[][];
  inputCommitments: bigint[];
  outputCommitments: bigint[];
  freivaldsAlpha: bigint;
  announcementR: bigint;
  challenge: bigint;
  responseBlinding: bigint;
  context: string;
}

export class ZeroKnowledgeCommitmentMatrixProver {
  public commitVector(values: bigint[]): CommittedVector {
    if (values.length === 0) throw new Error('Vector cannot be empty');
    const normalized = values.map((v) => modScalar(v));
    const blindings = normalized.map(() => randomScalar());
    const commitments = normalized.map((v, i) =>
      (modPow(BASE_G, v, SAFE_PRIME_P) * modPow(BASE_H, blindings[i], SAFE_PRIME_P)) % SAFE_PRIME_P,
    );
    return { values: normalized, blindings, commitments };
  }

  public multiplyMatrixVector(matrix: bigint[][], x: bigint[]): bigint[] {
    if (matrix.length === 0 || matrix[0].length !== x.length) {
      throw new RangeError('Incompatible matrix and vector dimensions');
    }
    const cols = x.length;
    return matrix.map((row) => {
      if (row.length !== cols) throw new RangeError('Jagged matrix rows are not permitted');
      let acc = 0n;
      for (let j = 0; j < cols; j++) {
        acc = modScalar(acc + modScalar(row[j]) * modScalar(x[j]));
      }
      return acc;
    });
  }

  private computeFreivaldsAlpha(
    matrix: bigint[][],
    inputCommitments: bigint[],
    outputCommitments: bigint[],
    context: string,
  ): bigint {
    return hashToScalar(
      'MATVEC-FREIVALDS-ALPHA-V1',
      context,
      String(matrix.length),
      String(inputCommitments.length),
      ...matrix.flat().map((v) => modScalar(v).toString(16)),
      ...inputCommitments.map((c) => c.toString(16)),
      ...outputCommitments.map((c) => c.toString(16)),
    );
  }

  private buildLeftFoldWeights(matrix: bigint[][], alpha: bigint): { u: bigint[]; uTM: bigint[] } {
    const rows = matrix.length;
    const cols = matrix[0].length;
    const u: bigint[] = [];
    let aPow = 1n;
    for (let i = 0; i < rows; i++) {
      u.push(aPow);
      aPow = modScalar(aPow * alpha);
    }
    const uTM = new Array<bigint>(cols).fill(0n);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        uTM[j] = modScalar(uTM[j] + u[i] * modScalar(matrix[i][j]));
      }
    }
    return { u, uTM };
  }

  public proveMatrixVectorProduct(
    matrix: bigint[][],
    xCommitted: CommittedVector,
    yCommitted: CommittedVector,
    context = 'matvec-v1',
  ): MatrixVectorProductProof {
    const rows = matrix.length;
    const cols = xCommitted.values.length;
    if (rows === 0 || yCommitted.values.length !== rows) {
      throw new RangeError('Output vector length must match matrix row count');
    }
    const expectedY = this.multiplyMatrixVector(matrix, xCommitted.values);
    for (let i = 0; i < rows; i++) {
      if (expectedY[i] !== yCommitted.values[i]) {
        throw new Error(`Matrix-vector product mismatch at row ${i}`);
      }
    }

    const freivaldsAlpha = this.computeFreivaldsAlpha(matrix, xCommitted.commitments, yCommitted.commitments, context);
    const { u, uTM } = this.buildLeftFoldWeights(matrix, freivaldsAlpha);

    let leftBlinding = 0n;
    for (let j = 0; j < cols; j++) {
      leftBlinding = modScalar(leftBlinding + uTM[j] * xCommitted.blindings[j]);
    }
    let rightBlinding = 0n;
    for (let i = 0; i < rows; i++) {
      rightBlinding = modScalar(rightBlinding + u[i] * yCommitted.blindings[i]);
    }
    const deltaBlinding = modScalar(leftBlinding - rightBlinding);

    const k = randomScalar();
    const announcementR = modPow(BASE_H, k, SAFE_PRIME_P);
    const challenge = hashToScalar(
      'MATVEC-FREIVALDS-CHALLENGE-V1',
      freivaldsAlpha.toString(16),
      announcementR.toString(16),
      context,
    );
    const responseBlinding = modScalar(k + challenge * deltaBlinding);

    return {
      rows,
      cols,
      matrix: matrix.map((row) => row.map((v) => modScalar(v))),
      inputCommitments: [...xCommitted.commitments],
      outputCommitments: [...yCommitted.commitments],
      freivaldsAlpha,
      announcementR,
      challenge,
      responseBlinding,
      context,
    };
  }

  public verifyMatrixVectorProduct(proof: MatrixVectorProductProof): boolean {
    if (
      proof.rows === 0 ||
      proof.cols === 0 ||
      proof.matrix.length !== proof.rows ||
      proof.inputCommitments.length !== proof.cols ||
      proof.outputCommitments.length !== proof.rows
    ) {
      return false;
    }
    if (proof.matrix.some((row) => row.length !== proof.cols)) return false;

    const expectedAlpha = this.computeFreivaldsAlpha(
      proof.matrix,
      proof.inputCommitments,
      proof.outputCommitments,
      proof.context,
    );
    if (expectedAlpha !== proof.freivaldsAlpha) return false;

    const expectedC = hashToScalar(
      'MATVEC-FREIVALDS-CHALLENGE-V1',
      proof.freivaldsAlpha.toString(16),
      proof.announcementR.toString(16),
      proof.context,
    );
    if (expectedC !== proof.challenge) return false;

    const { u, uTM } = this.buildLeftFoldWeights(proof.matrix, proof.freivaldsAlpha);
    let lhsComm = 1n;
    for (let j = 0; j < proof.cols; j++) {
      lhsComm = (lhsComm * modPow(proof.inputCommitments[j], uTM[j], SAFE_PRIME_P)) % SAFE_PRIME_P;
    }
    let rhsComm = 1n;
    for (let i = 0; i < proof.rows; i++) {
      rhsComm = (rhsComm * modPow(proof.outputCommitments[i], u[i], SAFE_PRIME_P)) % SAFE_PRIME_P;
    }

    const ratio = (lhsComm * modPow(rhsComm, SAFE_PRIME_P - 2n, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const lhs = modPow(BASE_H, proof.responseBlinding, SAFE_PRIME_P);
    const rhs = (proof.announcementR * modPow(ratio, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return lhs === rhs;
  }

  public serializeProof(proof: MatrixVectorProductProof): string {
    return JSON.stringify({
      rows: proof.rows,
      cols: proof.cols,
      freivaldsAlpha: proof.freivaldsAlpha.toString(16),
      context: proof.context,
    });
  }
}
