import { createHash } from 'crypto';

/**
 * Transparent Post-Quantum STARK FRI Low-Degree Folding Verifier
 *
 * Implements the Fast Reed-Solomon Interactive Oracle Proof of Proximity (FRI,
 * Ben-Sasson et al. 2018) over BN254 scalar field Fr:
 *   1. Evaluates degree < d polynomials over a 2-adic multiplicative blowup
 *      domain D_0 of size N = d * blowupFactor and commits via SHA-256 Merkle trees.
 *   2. Recursively splits and folds codewords across log2(d) rounds:
 *        f_{r+1}(x^2) = (f_r(x) + f_r(-x))/2 + alpha_r * (f_r(x) - f_r(-x))/(2x)
 *      until reaching a constant degree-0 polynomial.
 *   3. Verifies Fiat-Shamir colinearity queries across every folding layer with
 *      full Merkle authentication paths.
 */

const FIELD_MODULUS =
  0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n; // BN254 Fr
const INV_TWO = (FIELD_MODULUS + 1n) >> 1n;
const TWO_ADIC_GENERATOR = 5n;

export interface MerkleAuthPath {
  readonly leafIndex: number;
  readonly leafValue: bigint;
  readonly siblingHashes: readonly string[];
}

export interface FRICommitLayer {
  readonly roundIndex: number;
  readonly domainSize: number;
  readonly merkleRoot: string;
  readonly foldingAlpha: bigint;
}

export interface FRIQueryStep {
  readonly roundIndex: number;
  readonly posPath: MerkleAuthPath;
  readonly negPath: MerkleAuthPath;
  readonly foldedValue: bigint;
}

export interface FRIQueryProof {
  readonly initialIndex: number;
  readonly steps: readonly FRIQueryStep[];
}

export interface FRIProof {
  readonly degreeBound: number;
  readonly blowupFactor: number;
  readonly initialDomainSize: number;
  readonly layers: readonly FRICommitLayer[];
  readonly finalConstant: bigint;
  readonly queries: readonly FRIQueryProof[];
  readonly transcriptDigest: string;
}

export interface FRIVerificationResult {
  readonly isValid: boolean;
  readonly verifiedQueries: number;
  readonly verifiedLayers: number;
  readonly reason?: string;
}

function modField(x: bigint): bigint {
  const r = x % FIELD_MODULUS;
  return r >= 0n ? r : r + FIELD_MODULUS;
}

function modPow(base: bigint, exp: bigint): bigint {
  let result = 1n;
  let b = modField(base);
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) {
      result = modField(result * b);
    }
    b = modField(b * b);
    e >>= 1n;
  }
  return result;
}

function modInverse(a: bigint): bigint {
  const val = modField(a);
  if (val === 0n) throw new Error('Cannot invert zero in BN254 Fr');
  return modPow(val, FIELD_MODULUS - 2n);
}

function evalPoly(coeffs: readonly bigint[], x: bigint): bigint {
  let acc = 0n;
  const pt = modField(x);
  for (let i = coeffs.length - 1; i >= 0; i--) {
    acc = modField(acc * pt + modField(coeffs[i]));
  }
  return acc;
}

function hashLeaf(index: number, value: bigint): string {
  return createHash('sha256')
    .update(`FRI_LEAF|${index}|${modField(value).toString(16)}`)
    .digest('hex');
}

function hashNode(left: string, right: string): string {
  return createHash('sha256').update(`FRI_NODE|${left}|${right}`).digest('hex');
}

function hashChallenge(domain: string, parts: readonly string[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const p of parts) {
    h.update('|');
    h.update(p);
  }
  const s = modField(BigInt('0x' + h.digest('hex')));
  return s === 0n ? 1n : s;
}

function digestHex(domain: string, parts: readonly string[]): string {
  const h = createHash('sha256');
  h.update(domain);
  for (const p of parts) {
    h.update('|');
    h.update(p);
  }
  return h.digest('hex');
}

class BinaryMerkleTree {
  private readonly levels: string[][];
  private readonly values: readonly bigint[];

  constructor(values: readonly bigint[]) {
    this.values = values;
    let level = values.map((v, i) => hashLeaf(i, v));
    const levels: string[][] = [level];
    while (level.length > 1) {
      const next: string[] = [];
      for (let i = 0; i < level.length; i += 2) {
        next.push(hashNode(level[i], level[i + 1]));
      }
      levels.push(next);
      level = next;
    }
    this.levels = levels;
  }

  public getRoot(): string {
    return this.levels[this.levels.length - 1][0];
  }

  public open(index: number): MerkleAuthPath {
    const siblingHashes: string[] = [];
    let idx = index;
    for (let lvl = 0; lvl < this.levels.length - 1; lvl++) {
      const sib = idx ^ 1;
      siblingHashes.push(this.levels[lvl][sib]);
      idx >>= 1;
    }
    return {
      leafIndex: index,
      leafValue: this.values[index],
      siblingHashes,
    };
  }

  public static verifyPath(path: MerkleAuthPath, expectedRoot: string, treeSize: number): boolean {
    const expectedDepth = Math.round(Math.log2(treeSize));
    if (
      path.leafIndex < 0 ||
      path.leafIndex >= treeSize ||
      path.siblingHashes.length !== expectedDepth
    ) {
      return false;
    }
    let cur = hashLeaf(path.leafIndex, path.leafValue);
    let idx = path.leafIndex;
    for (const sib of path.siblingHashes) {
      cur = (idx & 1) === 0 ? hashNode(cur, sib) : hashNode(sib, cur);
      idx >>= 1;
    }
    return cur === expectedRoot;
  }
}

export class FRILowDegreeTester {
  private readonly degreeBound: number;
  private readonly blowupFactor: number;
  private readonly initialDomainSize: number;
  private readonly numFoldingRounds: number;
  private readonly numQueries: number;
  private readonly initialOmega: bigint;

  constructor(degreeBound = 8, blowupFactor = 4, numQueries = 4) {
    if (
      !Number.isInteger(degreeBound) ||
      degreeBound < 2 ||
      (degreeBound & (degreeBound - 1)) !== 0
    ) {
      throw new Error('degreeBound must be a power of 2 >= 2');
    }
    if (
      !Number.isInteger(blowupFactor) ||
      blowupFactor < 2 ||
      (blowupFactor & (blowupFactor - 1)) !== 0
    ) {
      throw new Error('blowupFactor must be a power of 2 >= 2');
    }
    if (!Number.isInteger(numQueries) || numQueries < 1 || numQueries > 32) {
      throw new Error('numQueries must be between 1 and 32');
    }

    this.degreeBound = degreeBound;
    this.blowupFactor = blowupFactor;
    this.initialDomainSize = degreeBound * blowupFactor;
    this.numFoldingRounds = Math.round(Math.log2(degreeBound));
    this.numQueries = numQueries;

    const logN = Math.round(Math.log2(this.initialDomainSize));
    this.initialOmega = modPow(TWO_ADIC_GENERATOR, (FIELD_MODULUS - 1n) >> BigInt(logN));
  }

  public getInitialDomainSize(): number {
    return this.initialDomainSize;
  }

  public evaluateOnDomain(polyCoeffs: readonly bigint[]): bigint[] {
    const evals: bigint[] = new Array<bigint>(this.initialDomainSize);
    let x = 1n;
    for (let i = 0; i < this.initialDomainSize; i++) {
      evals[i] = evalPoly(polyCoeffs, x);
      x = modField(x * this.initialOmega);
    }
    return evals;
  }

  public prove(polyCoeffs: readonly bigint[]): FRIProof {
    if (polyCoeffs.length === 0 || polyCoeffs.length > this.degreeBound) {
      throw new Error(`Polynomial degree must be strictly less than degreeBound ${this.degreeBound}`);
    }

    let currentEvals = this.evaluateOnDomain(polyCoeffs);
    let currentOmega = this.initialOmega;
    const trees: BinaryMerkleTree[] = [];
    const layers: FRICommitLayer[] = [];

    let transcript = digestHex('FRI_INIT', [
      String(this.degreeBound),
      String(this.blowupFactor),
      String(this.numQueries),
    ]);

    for (let round = 0; round < this.numFoldingRounds; round++) {
      const tree = new BinaryMerkleTree(currentEvals);
      const root = tree.getRoot();
      trees.push(tree);

      const foldingAlpha = hashChallenge('FRI_ALPHA', [transcript, String(round), root]);
      transcript = digestHex('FRI_COMMIT_STEP', [transcript, root, foldingAlpha.toString(16)]);

      layers.push({
        roundIndex: round,
        domainSize: currentEvals.length,
        merkleRoot: root,
        foldingAlpha,
      });

      const half = currentEvals.length >> 1;
      const nextEvals = new Array<bigint>(half);
      let x = 1n;
      for (let j = 0; j < half; j++) {
        const fPos = currentEvals[j];
        const fNeg = currentEvals[j + half];
        const evenPart = modField(modField(fPos + fNeg) * INV_TWO);
        const oddPart = modField(modField(modField(fPos - fNeg) * INV_TWO) * modInverse(x));
        nextEvals[j] = modField(evenPart + modField(foldingAlpha * oddPart));
        x = modField(x * currentOmega);
      }

      currentEvals = nextEvals;
      currentOmega = modField(currentOmega * currentOmega);
    }

    const finalConstant = currentEvals[0];
    for (let i = 1; i < currentEvals.length; i++) {
      if (currentEvals[i] !== finalConstant) {
        throw new Error('FRI folding failed to converge to a constant degree-0 codeword');
      }
    }

    transcript = digestHex('FRI_FINAL_CONST', [transcript, finalConstant.toString(16)]);

    const queries: FRIQueryProof[] = [];
    for (let q = 0; q < this.numQueries; q++) {
      const qScalar = hashChallenge('FRI_QUERY_IDX', [transcript, String(q)]);
      const initialIndex = Number(qScalar % BigInt(this.initialDomainSize));

      const steps: FRIQueryStep[] = [];
      let idx = initialIndex;
      let omegaR = this.initialOmega;

      for (let round = 0; round < this.numFoldingRounds; round++) {
        const domainSize = layers[round].domainSize;
        const half = domainSize >> 1;
        const posIdx = idx % half;
        const negIdx = posIdx + half;

        const posPath = trees[round].open(posIdx);
        const negPath = trees[round].open(negIdx);
        const x = modPow(omegaR, BigInt(posIdx));
        const evenPart = modField(modField(posPath.leafValue + negPath.leafValue) * INV_TWO);
        const oddPart = modField(
          modField(modField(posPath.leafValue - negPath.leafValue) * INV_TWO) * modInverse(x)
        );
        const foldedValue = modField(evenPart + modField(layers[round].foldingAlpha * oddPart));

        steps.push({ roundIndex: round, posPath, negPath, foldedValue });
        idx = posIdx;
        omegaR = modField(omegaR * omegaR);
      }

      queries.push({ initialIndex, steps });
    }

    return {
      degreeBound: this.degreeBound,
      blowupFactor: this.blowupFactor,
      initialDomainSize: this.initialDomainSize,
      layers,
      finalConstant,
      queries,
      transcriptDigest: transcript,
    };
  }

  public verify(proof: FRIProof): FRIVerificationResult {
    if (
      proof.degreeBound !== this.degreeBound ||
      proof.blowupFactor !== this.blowupFactor ||
      proof.initialDomainSize !== this.initialDomainSize ||
      proof.layers.length !== this.numFoldingRounds ||
      proof.queries.length !== this.numQueries
    ) {
      return {
        isValid: false,
        verifiedQueries: 0,
        verifiedLayers: 0,
        reason: 'FRI proof parameter or layer count mismatch',
      };
    }

    let transcript = digestHex('FRI_INIT', [
      String(this.degreeBound),
      String(this.blowupFactor),
      String(this.numQueries),
    ]);

    for (let round = 0; round < this.numFoldingRounds; round++) {
      const layer = proof.layers[round];
      const expectedSize = this.initialDomainSize >> round;
      if (layer.roundIndex !== round || layer.domainSize !== expectedSize) {
        return {
          isValid: false,
          verifiedQueries: 0,
          verifiedLayers: round,
          reason: `FRI layer ${round} metadata mismatch`,
        };
      }
      const expectedAlpha = hashChallenge('FRI_ALPHA', [transcript, String(round), layer.merkleRoot]);
      if (expectedAlpha !== layer.foldingAlpha) {
        return {
          isValid: false,
          verifiedQueries: 0,
          verifiedLayers: round,
          reason: `FRI Fiat-Shamir folding alpha mismatch at layer ${round}`,
        };
      }
      transcript = digestHex('FRI_COMMIT_STEP', [
        transcript,
        layer.merkleRoot,
        expectedAlpha.toString(16),
      ]);
    }

    transcript = digestHex('FRI_FINAL_CONST', [transcript, modField(proof.finalConstant).toString(16)]);
    if (transcript !== proof.transcriptDigest) {
      return {
        isValid: false,
        verifiedQueries: 0,
        verifiedLayers: this.numFoldingRounds,
        reason: 'FRI transcript digest mismatch',
      };
    }

    for (let q = 0; q < this.numQueries; q++) {
      const qp = proof.queries[q];
      const expectedInitIdx = Number(
        hashChallenge('FRI_QUERY_IDX', [transcript, String(q)]) % BigInt(this.initialDomainSize)
      );
      if (qp.initialIndex !== expectedInitIdx || qp.steps.length !== this.numFoldingRounds) {
        return {
          isValid: false,
          verifiedQueries: q,
          verifiedLayers: this.numFoldingRounds,
          reason: `Query ${q} index or step count mismatch`,
        };
      }

      let idx = expectedInitIdx;
      let omegaR = this.initialOmega;
      let prevFolded: bigint | null = null;

      for (let round = 0; round < this.numFoldingRounds; round++) {
        const step = qp.steps[round];
        const layer = proof.layers[round];
        const half = layer.domainSize >> 1;
        const expectedPos = idx % half;
        const expectedNeg = expectedPos + half;

        if (
          step.roundIndex !== round ||
          step.posPath.leafIndex !== expectedPos ||
          step.negPath.leafIndex !== expectedNeg
        ) {
          return {
            isValid: false,
            verifiedQueries: q,
            verifiedLayers: round,
            reason: `Query ${q} round ${round} index alignment mismatch`,
          };
        }

        if (
          !BinaryMerkleTree.verifyPath(step.posPath, layer.merkleRoot, layer.domainSize) ||
          !BinaryMerkleTree.verifyPath(step.negPath, layer.merkleRoot, layer.domainSize)
        ) {
          return {
            isValid: false,
            verifiedQueries: q,
            verifiedLayers: round,
            reason: `Query ${q} round ${round} Merkle authentication failed`,
          };
        }

        // Cross-layer consistency: value opened at idx in round r must equal folded value from round r - 1
        if (prevFolded !== null) {
          const openedAtIdx = idx === expectedPos ? step.posPath.leafValue : step.negPath.leafValue;
          if (modField(openedAtIdx) !== prevFolded) {
            return {
              isValid: false,
              verifiedQueries: q,
              verifiedLayers: round,
              reason: `Query ${q} cross-layer colinearity mismatch at round ${round}`,
            };
          }
        }

        const x = modPow(omegaR, BigInt(expectedPos));
        const evenPart = modField(modField(step.posPath.leafValue + step.negPath.leafValue) * INV_TWO);
        const oddPart = modField(
          modField(modField(step.posPath.leafValue - step.negPath.leafValue) * INV_TWO) * modInverse(x)
        );
        const expectedFolded = modField(evenPart + modField(layer.foldingAlpha * oddPart));

        if (expectedFolded !== step.foldedValue) {
          return {
            isValid: false,
            verifiedQueries: q,
            verifiedLayers: round,
            reason: `Query ${q} colinearity check failed at round ${round}`,
          };
        }

        prevFolded = expectedFolded;
        idx = expectedPos;
        omegaR = modField(omegaR * omegaR);
      }

      if (prevFolded !== modField(proof.finalConstant)) {
        return {
          isValid: false,
          verifiedQueries: q,
          verifiedLayers: this.numFoldingRounds,
          reason: `Query ${q} final folded value does not match final constant`,
        };
      }
    }

    return {
      isValid: true,
      verifiedQueries: this.numQueries,
      verifiedLayers: this.numFoldingRounds,
    };
  }
}
