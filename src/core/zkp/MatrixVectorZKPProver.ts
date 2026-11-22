/**
 * @file MatrixVectorZKPProver.ts
 * @description Zero-Knowledge Matrix-Vector Multiplication Argument (zkML Linear Layer Prover).
 * Proves that committed vectors satisfy y = M * x over BN254 without revealing secret inputs x
 * or outputs y. Combines Freivalds Fiat-Shamir random linear projection with a zero-knowledge
 * Sigma protocol over perfectly hiding Pedersen vector commitments.
 */

import { createHash, randomBytes } from 'crypto';

export const MATVEC_PRIME = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Field arithmetic utilities over BN254.
 */
export class MatVecFieldMath {
  public static add(a: bigint, b: bigint, p: bigint = MATVEC_PRIME): bigint {
    const res = (a + b) % p;
    return res >= 0n ? res : res + p;
  }

  public static sub(a: bigint, b: bigint, p: bigint = MATVEC_PRIME): bigint {
    const res = (a - b) % p;
    return res >= 0n ? res : res + p;
  }

  public static mul(a: bigint, b: bigint, p: bigint = MATVEC_PRIME): bigint {
    const res = (a * b) % p;
    return res >= 0n ? res : res + p;
  }

  public static hashToScalar(data: string, p: bigint = MATVEC_PRIME): bigint {
    const h = createHash('sha256').update(data).digest('hex');
    const val = BigInt('0x' + h) % p;
    return val === 0n ? 1n : val;
  }

  public static randomScalar(p: bigint = MATVEC_PRIME): bigint {
    const b = randomBytes(32);
    const val = BigInt('0x' + b.toString('hex')) % p;
    return val === 0n ? 1n : val;
  }

  public static dot(a: bigint[], b: bigint[], p: bigint = MATVEC_PRIME): bigint {
    let sum = 0n;
    for (let i = 0; i < a.length; i++) {
      sum = this.add(sum, this.mul(a[i], b[i], p), p);
    }
    return sum;
  }
}

/**
 * Pedersen vector commitment key for input and output spaces.
 */
export interface MatrixVectorCommitKey {
  gInput: bigint[];
  uOutput: bigint[];
  h: bigint;
  maxCols: number;
  maxRows: number;
}

/**
 * Public statement containing commitments to input x and output y = M * x.
 */
export interface MatrixVectorStatement {
  commitmentX: bigint;
  commitmentY: bigint;
  rows: number;
  cols: number;
}

/**
 * Non-interactive zero-knowledge proof of y = M * x.
 */
export interface MatrixVectorProof {
  alpha: bigint;
  commitmentAx: bigint;
  commitmentAy: bigint;
  commitmentAProj: bigint;
  challengeE: bigint;
  responseZx: bigint[];
  responseZbx: bigint;
  responseZy: bigint[];
  responseZby: bigint;
}

/**
 * Verification outcome.
 */
export interface MatrixVectorVerificationResult {
  isValid: boolean;
  reason?: string;
}

/**
 * Zero-Knowledge Matrix-Vector Multiplication Prover & Verifier.
 */
export class MatrixVectorZKPProver {
  public readonly prime: bigint;
  public readonly key: MatrixVectorCommitKey;

  constructor(maxCols: number = 64, maxRows: number = 64, prime: bigint = MATVEC_PRIME) {
    this.prime = prime;
    this.key = this.setup(maxCols, maxRows);
  }

  /**
   * Generates NUMS Pedersen commitment generators for input and output vectors.
   */
  public setup(maxCols: number, maxRows: number): MatrixVectorCommitKey {
    const gInput: bigint[] = new Array(maxCols);
    for (let j = 0; j < maxCols; j++) {
      gInput[j] = MatVecFieldMath.hashToScalar(`matvec_G_${j}`, this.prime);
    }
    const uOutput: bigint[] = new Array(maxRows);
    for (let i = 0; i < maxRows; i++) {
      uOutput[i] = MatVecFieldMath.hashToScalar(`matvec_U_${i}`, this.prime);
    }
    const h = MatVecFieldMath.hashToScalar('matvec_H', this.prime);

    return { gInput, uOutput, h, maxCols, maxRows };
  }

  /**
   * Commits to input vector x: C_x = <x, G> + blinding * H mod p.
   */
  public commitInput(x: bigint[], blinding: bigint): bigint {
    if (x.length > this.key.maxCols) {
      throw new Error(`Input length ${x.length} exceeds maxCols ${this.key.maxCols}`);
    }
    const base = MatVecFieldMath.dot(x, this.key.gInput.slice(0, x.length), this.prime);
    return MatVecFieldMath.add(base, MatVecFieldMath.mul(blinding, this.key.h, this.prime), this.prime);
  }

  /**
   * Commits to output vector y: C_y = <y, U> + blinding * H mod p.
   */
  public commitOutput(y: bigint[], blinding: bigint): bigint {
    if (y.length > this.key.maxRows) {
      throw new Error(`Output length ${y.length} exceeds maxRows ${this.key.maxRows}`);
    }
    const base = MatVecFieldMath.dot(y, this.key.uOutput.slice(0, y.length), this.prime);
    return MatVecFieldMath.add(base, MatVecFieldMath.mul(blinding, this.key.h, this.prime), this.prime);
  }

  /**
   * Computes exact matrix-vector product y = M * x mod p.
   */
  public multiply(matrix: bigint[][], x: bigint[]): bigint[] {
    const rows = matrix.length;
    if (rows === 0) throw new Error('Matrix cannot be empty');
    const cols = matrix[0].length;
    if (x.length !== cols) {
      throw new Error(`Dimension mismatch: matrix has ${cols} cols, vector has ${x.length}`);
    }

    const y: bigint[] = new Array(rows);
    for (let i = 0; i < rows; i++) {
      if (matrix[i].length !== cols) {
        throw new Error(`Ragged matrix at row ${i}`);
      }
      y[i] = MatVecFieldMath.dot(matrix[i], x, this.prime);
    }
    return y;
  }

  /**
   * Builds Freivalds challenge vector rho = [1, alpha, alpha^2, ..., alpha^{r-1}]
   * and projected row vector m = rho^T * M.
   */
  private computeFreivaldsProjection(
    matrix: bigint[][],
    alpha: bigint
  ): { rho: bigint[]; projectedRow: bigint[] } {
    const rows = matrix.length;
    const cols = matrix[0].length;

    const rho: bigint[] = new Array(rows);
    let pow = 1n;
    for (let i = 0; i < rows; i++) {
      rho[i] = pow;
      pow = MatVecFieldMath.mul(pow, alpha, this.prime);
    }

    const projectedRow: bigint[] = new Array(cols).fill(0n);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        projectedRow[j] = MatVecFieldMath.add(
          projectedRow[j],
          MatVecFieldMath.mul(rho[i], matrix[i][j], this.prime),
          this.prime
        );
      }
    }

    return { rho, projectedRow };
  }

  /**
   * Generates a zero-knowledge proof that committed vectors satisfy y = M * x.
   */
  public proveMatrixVectorProduct(
    matrix: bigint[][],
    x: bigint[],
    blindingX?: bigint,
    blindingY?: bigint
  ): { statement: MatrixVectorStatement; proof: MatrixVectorProof; outputY: bigint[] } {
    const rows = matrix.length;
    const cols = matrix[0].length;
    const normX = x.map((v) => ((v % this.prime) + this.prime) % this.prime);
    const y = this.multiply(matrix, normX);

    const bx = blindingX ?? MatVecFieldMath.randomScalar(this.prime);
    const by = blindingY ?? MatVecFieldMath.randomScalar(this.prime);

    const commitmentX = this.commitInput(normX, bx);
    const commitmentY = this.commitOutput(y, by);

    // 1. Derive Freivalds challenge alpha via Fiat-Shamir
    const transcript1 = `${commitmentX.toString(16)}:${commitmentY.toString(16)}:${rows}:${cols}`;
    const alpha = MatVecFieldMath.hashToScalar(transcript1, this.prime);
    const { rho, projectedRow } = this.computeFreivaldsProjection(matrix, alpha);

    // 2. Sample uniform masking vectors for zero-knowledge Sigma protocol
    const kx: bigint[] = Array.from({ length: cols }, () => MatVecFieldMath.randomScalar(this.prime));
    const ky: bigint[] = Array.from({ length: rows }, () => MatVecFieldMath.randomScalar(this.prime));
    const kbx = MatVecFieldMath.randomScalar(this.prime);
    const kby = MatVecFieldMath.randomScalar(this.prime);

    const commitmentAx = this.commitInput(kx, kbx);
    const commitmentAy = this.commitOutput(ky, kby);
    const commitmentAProj = MatVecFieldMath.sub(
      MatVecFieldMath.dot(projectedRow, kx, this.prime),
      MatVecFieldMath.dot(rho, ky, this.prime),
      this.prime
    );

    // 3. Derive Sigma challenge e
    const transcript2 = `${transcript1}:${alpha.toString(16)}:${commitmentAx.toString(16)}:${commitmentAy.toString(16)}:${commitmentAProj.toString(16)}`;
    const challengeE = MatVecFieldMath.hashToScalar(transcript2, this.prime);

    // 4. Compute masked responses
    const responseZx = normX.map((val, j) =>
      MatVecFieldMath.add(kx[j], MatVecFieldMath.mul(challengeE, val, this.prime), this.prime)
    );
    const responseZbx = MatVecFieldMath.add(kbx, MatVecFieldMath.mul(challengeE, bx, this.prime), this.prime);

    const responseZy = y.map((val, i) =>
      MatVecFieldMath.add(ky[i], MatVecFieldMath.mul(challengeE, val, this.prime), this.prime)
    );
    const responseZby = MatVecFieldMath.add(kby, MatVecFieldMath.mul(challengeE, by, this.prime), this.prime);

    return {
      statement: { commitmentX, commitmentY, rows, cols },
      proof: {
        alpha,
        commitmentAx,
        commitmentAy,
        commitmentAProj,
        challengeE,
        responseZx,
        responseZbx,
        responseZy,
        responseZby,
      },
      outputY: y,
    };
  }

  /**
   * Verifies the zero-knowledge matrix-vector multiplication proof without accessing x or y.
   */
  public verifyMatrixVectorProduct(
    matrix: bigint[][],
    statement: MatrixVectorStatement,
    proof: MatrixVectorProof
  ): MatrixVectorVerificationResult {
    const { commitmentX, commitmentY, rows, cols } = statement;
    if (matrix.length !== rows || matrix[0]?.length !== cols) {
      return { isValid: false, reason: 'Matrix dimensions do not match statement' };
    }
    if (proof.responseZx.length !== cols || proof.responseZy.length !== rows) {
      return { isValid: false, reason: 'Response vector dimensions mismatch' };
    }

    // 1. Re-derive Freivalds challenge alpha
    const transcript1 = `${commitmentX.toString(16)}:${commitmentY.toString(16)}:${rows}:${cols}`;
    const expectedAlpha = MatVecFieldMath.hashToScalar(transcript1, this.prime);
    if (proof.alpha !== expectedAlpha) {
      return { isValid: false, reason: 'Freivalds challenge alpha mismatch' };
    }

    // 2. Re-derive Sigma challenge e
    const transcript2 = `${transcript1}:${proof.alpha.toString(16)}:${proof.commitmentAx.toString(16)}:${proof.commitmentAy.toString(16)}:${proof.commitmentAProj.toString(16)}`;
    const expectedE = MatVecFieldMath.hashToScalar(transcript2, this.prime);
    if (proof.challengeE !== expectedE) {
      return { isValid: false, reason: 'Sigma challenge e mismatch' };
    }

    // 3. Verify input commitment opening: Commit(z_x, z_bx) == A_x + e * C_x
    const lhsX = this.commitInput(proof.responseZx, proof.responseZbx);
    const rhsX = MatVecFieldMath.add(
      proof.commitmentAx,
      MatVecFieldMath.mul(proof.challengeE, commitmentX, this.prime),
      this.prime
    );
    if (lhsX !== rhsX) {
      return { isValid: false, reason: 'Input commitment Sigma check failed' };
    }

    // 4. Verify output commitment opening: Commit(z_y, z_by) == A_y + e * C_y
    const lhsY = this.commitOutput(proof.responseZy, proof.responseZby);
    const rhsY = MatVecFieldMath.add(
      proof.commitmentAy,
      MatVecFieldMath.mul(proof.challengeE, commitmentY, this.prime),
      this.prime
    );
    if (lhsY !== rhsY) {
      return { isValid: false, reason: 'Output commitment Sigma check failed' };
    }

    // 5. Verify projected linear constraint: <m, z_x> - <rho, z_y> == A_proj
    const { rho, projectedRow } = this.computeFreivaldsProjection(matrix, proof.alpha);
    const lhsProj = MatVecFieldMath.sub(
      MatVecFieldMath.dot(projectedRow, proof.responseZx, this.prime),
      MatVecFieldMath.dot(rho, proof.responseZy, this.prime),
      this.prime
    );
    if (lhsProj !== proof.commitmentAProj) {
      return { isValid: false, reason: 'Freivalds linear projection equation violated (y != M * x)' };
    }

    return { isValid: true };
  }
}
