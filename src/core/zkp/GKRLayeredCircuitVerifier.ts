import { createHash } from 'crypto';

/**
 * Goldwasser-Kalai-Rothblum (GKR) Layered Arithmetic Circuit Sumcheck Verifier
 *
 * Implements the non-interactive GKR protocol over BN254 scalar field Fr:
 *   - Evaluates layered arithmetic circuits of add and mul gates (layer 0 = output,
 *     layer d = input) where each layer i has 2^{k_i} gates.
 *   - Reduces each layer's linear multilinear claim sum_j w_i[j] * V_i[j] to two
 *     evaluations (V_{i+1}~(u), V_{i+1}~(v)) via a 2*k_{i+1}-round degree-2 LFKN
 *     sumcheck over the wiring predicates add_i(w, x, y) and mult_i(w, x, y).
 *   - Folds the two claims (V_{i+1}~(u), V_{i+1}~(v)) into a single linear claim
 *     alpha * V_{i+1}~(u) + beta * V_{i+1}~(v) via Fiat-Shamir challenges down to
 *     the input layer, verified directly against the input MLE.
 */

const FIELD_MODULUS =
  0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001n; // BN254 Fr
const INV_TWO = (FIELD_MODULUS + 1n) >> 1n;

export type GateOp = 'add' | 'mul';

export interface CircuitGate {
  readonly op: GateOp;
  readonly left: number;
  readonly right: number;
}

export interface CircuitLayerSpec {
  readonly numBits: number; // layer size = 2^numBits
  readonly gates: readonly CircuitGate[];
}

export interface LayeredCircuit {
  readonly inputBits: number; // input layer size = 2^inputBits
  readonly layers: readonly CircuitLayerSpec[]; // index 0 = output layer, last = layer above input
}

export interface GKRSumcheckRound {
  readonly roundIndex: number;
  readonly coeffs: readonly [bigint, bigint, bigint];
  readonly challenge: bigint;
}

export interface GKRLayerProof {
  readonly layerIndex: number;
  readonly inputClaim: bigint;
  readonly rounds: readonly GKRSumcheckRound[];
  readonly pointU: readonly bigint[];
  readonly pointV: readonly bigint[];
  readonly evalU: bigint;
  readonly evalV: bigint;
  readonly foldAlpha: bigint;
  readonly foldBeta: bigint;
}

export interface GKRProof {
  readonly outputValues: readonly bigint[];
  readonly initialPoint: readonly bigint[];
  readonly initialClaim: bigint;
  readonly layerProofs: readonly GKRLayerProof[];
  readonly transcriptDigest: string;
}

export interface GKRVerificationResult {
  readonly isValid: boolean;
  readonly verifiedLayers: number;
  readonly finalInputClaim: bigint;
  readonly reason?: string;
}

function modField(x: bigint): bigint {
  const r = x % FIELD_MODULUS;
  return r >= 0n ? r : r + FIELD_MODULUS;
}

function evalQuadratic(coeffs: readonly [bigint, bigint, bigint], x: bigint): bigint {
  const pt = modField(x);
  return modField(coeffs[0] + modField(pt * modField(coeffs[1] + modField(pt * coeffs[2]))));
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

function buildEqTable(point: readonly bigint[]): bigint[] {
  let table: bigint[] = [1n];
  for (let i = point.length - 1; i >= 0; i--) {
    const r = modField(point[i]);
    const oneMinusR = modField(1n - r);
    const next = new Array<bigint>(table.length * 2);
    for (let k = 0; k < table.length; k++) {
      next[2 * k] = modField(table[k] * oneMinusR);
      next[2 * k + 1] = modField(table[k] * r);
    }
    table = next;
  }
  return table;
}

function evaluateMLE(values: readonly bigint[], point: readonly bigint[]): bigint {
  const eq = buildEqTable(point);
  let acc = 0n;
  for (let i = 0; i < values.length; i++) {
    acc = modField(acc + modField(modField(values[i]) * eq[i]));
  }
  return acc;
}

function foldLinearTable(table: readonly bigint[], r: bigint): bigint[] {
  const half = table.length >> 1;
  const oneMinusR = modField(1n - r);
  const next = new Array<bigint>(half);
  for (let k = 0; k < half; k++) {
    next[k] = modField(modField(oneMinusR * table[2 * k]) + modField(r * table[2 * k + 1]));
  }
  return next;
}

export class GKRLayeredCircuitVerifier {
  private readonly circuit: LayeredCircuit;

  constructor(circuit: LayeredCircuit) {
    if (circuit.layers.length === 0) {
      throw new Error('GKR circuit must have at least one gate layer');
    }
    if (circuit.inputBits < 1 || circuit.inputBits > 8) {
      throw new Error('inputBits must be between 1 and 8');
    }

    for (let i = 0; i < circuit.layers.length; i++) {
      const layer = circuit.layers[i];
      const expectedSize = 1 << layer.numBits;
      if (layer.gates.length !== expectedSize) {
        throw new Error(`Layer ${i} must have exactly 2^${layer.numBits} = ${expectedSize} gates`);
      }
      const nextBits =
        i + 1 < circuit.layers.length ? circuit.layers[i + 1].numBits : circuit.inputBits;
      const nextSize = 1 << nextBits;
      for (const gate of layer.gates) {
        if (
          gate.left < 0 ||
          gate.left >= nextSize ||
          gate.right < 0 ||
          gate.right >= nextSize
        ) {
          throw new Error(`Layer ${i} gate wire index out of bounds`);
        }
      }
    }

    this.circuit = circuit;
  }

  public evaluateCircuit(inputs: readonly bigint[]): bigint[][] {
    const inputSize = 1 << this.circuit.inputBits;
    if (inputs.length !== inputSize) {
      throw new Error(`Expected ${inputSize} circuit inputs`);
    }

    const numLayers = this.circuit.layers.length;
    const layerValues: bigint[][] = new Array(numLayers + 1);
    layerValues[numLayers] = inputs.map((v) => modField(v));

    for (let i = numLayers - 1; i >= 0; i--) {
      const prev = layerValues[i + 1];
      const gates = this.circuit.layers[i].gates;
      layerValues[i] = gates.map((g) =>
        g.op === 'add'
          ? modField(prev[g.left] + prev[g.right])
          : modField(prev[g.left] * prev[g.right])
      );
    }

    return layerValues;
  }

  private evaluateWiringPredicates(
    layerIndex: number,
    weights: readonly bigint[],
    pointU: readonly bigint[],
    pointV: readonly bigint[]
  ): { addVal: bigint; multVal: bigint } {
    const eqU = buildEqTable(pointU);
    const eqV = buildEqTable(pointV);
    const gates = this.circuit.layers[layerIndex].gates;

    let addVal = 0n;
    let multVal = 0n;
    for (let j = 0; j < gates.length; j++) {
      const w = weights[j];
      if (w === 0n) continue;
      const term = modField(w * modField(eqU[gates[j].left] * eqV[gates[j].right]));
      if (gates[j].op === 'add') {
        addVal = modField(addVal + term);
      } else {
        multVal = modField(multVal + term);
      }
    }
    return { addVal, multVal };
  }

  public prove(inputs: readonly bigint[]): GKRProof {
    const layerValues = this.evaluateCircuit(inputs);
    const outputValues = layerValues[0];
    const outBits = this.circuit.layers[0].numBits;

    let transcript = digestHex('GKR_INIT', [
      String(this.circuit.layers.length),
      ...outputValues.map((v) => v.toString(16)),
    ]);

    const initialPoint: bigint[] = [];
    for (let b = 0; b < outBits; b++) {
      initialPoint.push(hashChallenge('GKR_G0', [transcript, String(b)]));
    }

    let weights = buildEqTable(initialPoint);
    let currentClaim = evaluateMLE(outputValues, initialPoint);
    const initialClaim = currentClaim;

    transcript = digestHex('GKR_OUT_CLAIM', [
      transcript,
      ...initialPoint.map((p) => p.toString(16)),
      initialClaim.toString(16),
    ]);

    const layerProofs: GKRLayerProof[] = [];

    for (let i = 0; i < this.circuit.layers.length; i++) {
      const nextValues = layerValues[i + 1];
      const nextBits =
        i + 1 < this.circuit.layers.length
          ? this.circuit.layers[i + 1].numBits
          : this.circuit.inputBits;
      const nextSize = 1 << nextBits;

      // Build A_w(x, y) and M_w(x, y) tables indexed by (x + nextSize * y)
      const gridSize = nextSize * nextSize;
      let addGrid = new Array<bigint>(gridSize).fill(0n);
      let multGrid = new Array<bigint>(gridSize).fill(0n);
      const gates = this.circuit.layers[i].gates;
      for (let j = 0; j < gates.length; j++) {
        const idx = gates[j].left + nextSize * gates[j].right;
        if (gates[j].op === 'add') {
          addGrid[idx] = modField(addGrid[idx] + weights[j]);
        } else {
          multGrid[idx] = modField(multGrid[idx] + weights[j]);
        }
      }

      // Phase 1: sumcheck over x variables (low bits 0..nextBits-1)
      let vxTable = [...nextValues];
      let vyTable = [...nextValues];
      const rounds: GKRSumcheckRound[] = [];
      const pointU: bigint[] = [];
      const pointV: bigint[] = [];

      // First nextBits rounds bind x = u (folding pairs along low bit of index)
      for (let rIdx = 0; rIdx < nextBits; rIdx++) {
        const curXSize = vxTable.length;
        const halfX = curXSize >> 1;
        let s0 = 0n;
        let s1 = 0n;
        let s2 = 0n;

        for (let y = 0; y < nextSize; y++) {
          const vy = vyTable[y];
          const rowBase = y * curXSize;
          for (let kx = 0; kx < halfX; kx++) {
            const a0 = addGrid[rowBase + 2 * kx];
            const a1 = addGrid[rowBase + 2 * kx + 1];
            const m0 = multGrid[rowBase + 2 * kx];
            const m1 = multGrid[rowBase + 2 * kx + 1];
            const x0 = vxTable[2 * kx];
            const x1 = vxTable[2 * kx + 1];

            s0 = modField(s0 + modField(a0 * modField(x0 + vy)) + modField(m0 * modField(x0 * vy)));
            s1 = modField(s1 + modField(a1 * modField(x1 + vy)) + modField(m1 * modField(x1 * vy)));

            const a2 = modField(modField(2n * a1) - a0);
            const m2 = modField(modField(2n * m1) - m0);
            const x2 = modField(modField(2n * x1) - x0);
            s2 = modField(s2 + modField(a2 * modField(x2 + vy)) + modField(m2 * modField(x2 * vy)));
          }
        }

        const c0 = s0;
        const c2 = modField(modField(s2 - modField(2n * s1) + s0) * INV_TWO);
        const c1 = modField(s1 - s0 - c2);
        const coeffs: [bigint, bigint, bigint] = [c0, c1, c2];

        const challenge = hashChallenge('GKR_SC_R', [
          transcript,
          String(i),
          String(rIdx),
          c0.toString(16),
          c1.toString(16),
          c2.toString(16),
        ]);
        transcript = digestHex('GKR_SC_STEP', [transcript, challenge.toString(16)]);
        rounds.push({ roundIndex: rIdx, coeffs, challenge });
        pointU.push(challenge);

        // Fold vxTable and each y-row of addGrid/multGrid
        vxTable = foldLinearTable(vxTable, challenge);
        const oneMinusR = modField(1n - challenge);
        const nextAdd = new Array<bigint>(nextSize * halfX);
        const nextMult = new Array<bigint>(nextSize * halfX);
        for (let y = 0; y < nextSize; y++) {
          const oldBase = y * curXSize;
          const newBase = y * halfX;
          for (let kx = 0; kx < halfX; kx++) {
            nextAdd[newBase + kx] = modField(
              modField(oneMinusR * addGrid[oldBase + 2 * kx]) +
                modField(challenge * addGrid[oldBase + 2 * kx + 1])
            );
            nextMult[newBase + kx] = modField(
              modField(oneMinusR * multGrid[oldBase + 2 * kx]) +
                modField(challenge * multGrid[oldBase + 2 * kx + 1])
            );
          }
        }
        addGrid = nextAdd;
        multGrid = nextMult;
      }

      // Now vxTable has length 1: evalU = V_{i+1}~(u), and addGrid/multGrid are 1D vectors over y
      const evalU = vxTable[0];

      // Next nextBits rounds bind y = v
      for (let rIdx = 0; rIdx < nextBits; rIdx++) {
        const halfY = vyTable.length >> 1;
        let s0 = 0n;
        let s1 = 0n;
        let s2 = 0n;

        for (let ky = 0; ky < halfY; ky++) {
          const a0 = addGrid[2 * ky];
          const a1 = addGrid[2 * ky + 1];
          const m0 = multGrid[2 * ky];
          const m1 = multGrid[2 * ky + 1];
          const y0 = vyTable[2 * ky];
          const y1 = vyTable[2 * ky + 1];

          s0 = modField(s0 + modField(a0 * modField(evalU + y0)) + modField(m0 * modField(evalU * y0)));
          s1 = modField(s1 + modField(a1 * modField(evalU + y1)) + modField(m1 * modField(evalU * y1)));

          const a2 = modField(modField(2n * a1) - a0);
          const m2 = modField(modField(2n * m1) - m0);
          const y2 = modField(modField(2n * y1) - y0);
          s2 = modField(s2 + modField(a2 * modField(evalU + y2)) + modField(m2 * modField(evalU * y2)));
        }

        const c0 = s0;
        const c2 = modField(modField(s2 - modField(2n * s1) + s0) * INV_TWO);
        const c1 = modField(s1 - s0 - c2);
        const coeffs: [bigint, bigint, bigint] = [c0, c1, c2];

        const roundNumber = nextBits + rIdx;
        const challenge = hashChallenge('GKR_SC_R', [
          transcript,
          String(i),
          String(roundNumber),
          c0.toString(16),
          c1.toString(16),
          c2.toString(16),
        ]);
        transcript = digestHex('GKR_SC_STEP', [transcript, challenge.toString(16)]);
        rounds.push({ roundIndex: roundNumber, coeffs, challenge });
        pointV.push(challenge);

        vyTable = foldLinearTable(vyTable, challenge);
        addGrid = foldLinearTable(addGrid, challenge);
        multGrid = foldLinearTable(multGrid, challenge);
      }

      const evalV = vyTable[0];

      // Fold (evalU, evalV) into single linear claim for layer i + 1
      const foldAlpha = hashChallenge('GKR_FOLD_A', [
        transcript,
        evalU.toString(16),
        evalV.toString(16),
      ]);
      const foldBeta = hashChallenge('GKR_FOLD_B', [
        transcript,
        evalU.toString(16),
        evalV.toString(16),
        foldAlpha.toString(16),
      ]);
      transcript = digestHex('GKR_LAYER_END', [
        transcript,
        evalU.toString(16),
        evalV.toString(16),
        foldAlpha.toString(16),
        foldBeta.toString(16),
      ]);

      layerProofs.push({
        layerIndex: i,
        inputClaim: currentClaim,
        rounds,
        pointU,
        pointV,
        evalU,
        evalV,
        foldAlpha,
        foldBeta,
      });

      const eqU = buildEqTable(pointU);
      const eqV = buildEqTable(pointV);
      weights = eqU.map((eu, idx) => modField(modField(foldAlpha * eu) + modField(foldBeta * eqV[idx])));
      currentClaim = modField(modField(foldAlpha * evalU) + modField(foldBeta * evalV));
    }

    return {
      outputValues,
      initialPoint,
      initialClaim,
      layerProofs,
      transcriptDigest: transcript,
    };
  }

  public verify(inputs: readonly bigint[], proof: GKRProof): GKRVerificationResult {
    const outBits = this.circuit.layers[0].numBits;
    const outSize = 1 << outBits;
    if (
      proof.outputValues.length !== outSize ||
      proof.initialPoint.length !== outBits ||
      proof.layerProofs.length !== this.circuit.layers.length
    ) {
      return {
        isValid: false,
        verifiedLayers: 0,
        finalInputClaim: 0n,
        reason: 'GKR proof structural dimension mismatch',
      };
    }

    let transcript = digestHex('GKR_INIT', [
      String(this.circuit.layers.length),
      ...proof.outputValues.map((v) => modField(v).toString(16)),
    ]);

    for (let b = 0; b < outBits; b++) {
      const expectedG = hashChallenge('GKR_G0', [transcript, String(b)]);
      if (expectedG !== proof.initialPoint[b]) {
        return {
          isValid: false,
          verifiedLayers: 0,
          finalInputClaim: 0n,
          reason: 'Initial output evaluation point mismatch',
        };
      }
    }

    const expectedInitClaim = evaluateMLE(proof.outputValues, proof.initialPoint);
    if (expectedInitClaim !== proof.initialClaim) {
      return {
        isValid: false,
        verifiedLayers: 0,
        finalInputClaim: 0n,
        reason: 'Initial output MLE claim mismatch',
      };
    }

    transcript = digestHex('GKR_OUT_CLAIM', [
      transcript,
      ...proof.initialPoint.map((p) => p.toString(16)),
      expectedInitClaim.toString(16),
    ]);

    let weights = buildEqTable(proof.initialPoint);
    let expectedClaim = expectedInitClaim;

    for (let i = 0; i < this.circuit.layers.length; i++) {
      const lp = proof.layerProofs[i];
      const nextBits =
        i + 1 < this.circuit.layers.length
          ? this.circuit.layers[i + 1].numBits
          : this.circuit.inputBits;

      if (
        lp.layerIndex !== i ||
        lp.inputClaim !== expectedClaim ||
        lp.rounds.length !== 2 * nextBits ||
        lp.pointU.length !== nextBits ||
        lp.pointV.length !== nextBits
      ) {
        return {
          isValid: false,
          verifiedLayers: i,
          finalInputClaim: expectedClaim,
          reason: `Layer ${i} proof metadata or claim mismatch`,
        };
      }

      let scClaim = expectedClaim;
      for (let rIdx = 0; rIdx < 2 * nextBits; rIdx++) {
        const r = lp.rounds[rIdx];
        if (r.roundIndex !== rIdx) {
          return {
            isValid: false,
            verifiedLayers: i,
            finalInputClaim: scClaim,
            reason: `Layer ${i} round index mismatch at ${rIdx}`,
          };
        }
        const p0 = evalQuadratic(r.coeffs, 0n);
        const p1 = evalQuadratic(r.coeffs, 1n);
        if (modField(p0 + p1) !== scClaim) {
          return {
            isValid: false,
            verifiedLayers: i,
            finalInputClaim: scClaim,
            reason: `Layer ${i} sumcheck p(0) + p(1) != claim at round ${rIdx}`,
          };
        }

        const expectedChallenge = hashChallenge('GKR_SC_R', [
          transcript,
          String(i),
          String(rIdx),
          modField(r.coeffs[0]).toString(16),
          modField(r.coeffs[1]).toString(16),
          modField(r.coeffs[2]).toString(16),
        ]);
        const targetCoord = rIdx < nextBits ? lp.pointU[rIdx] : lp.pointV[rIdx - nextBits];
        if (expectedChallenge !== r.challenge || expectedChallenge !== targetCoord) {
          return {
            isValid: false,
            verifiedLayers: i,
            finalInputClaim: scClaim,
            reason: `Layer ${i} Fiat-Shamir challenge mismatch at round ${rIdx}`,
          };
        }

        transcript = digestHex('GKR_SC_STEP', [transcript, expectedChallenge.toString(16)]);
        scClaim = evalQuadratic(r.coeffs, expectedChallenge);
      }

      // Check sumcheck final evaluation against wiring predicates add_i(w, u, v), mult_i(w, u, v)
      const { addVal, multVal } = this.evaluateWiringPredicates(i, weights, lp.pointU, lp.pointV);
      const expectedEnd = modField(
        modField(addVal * modField(lp.evalU + lp.evalV)) +
          modField(multVal * modField(lp.evalU * lp.evalV))
      );
      if (scClaim !== expectedEnd) {
        return {
          isValid: false,
          verifiedLayers: i,
          finalInputClaim: scClaim,
          reason: `Layer ${i} wiring predicate evaluation check failed`,
        };
      }

      const expectedAlpha = hashChallenge('GKR_FOLD_A', [
        transcript,
        modField(lp.evalU).toString(16),
        modField(lp.evalV).toString(16),
      ]);
      const expectedBeta = hashChallenge('GKR_FOLD_B', [
        transcript,
        modField(lp.evalU).toString(16),
        modField(lp.evalV).toString(16),
        expectedAlpha.toString(16),
      ]);
      if (expectedAlpha !== lp.foldAlpha || expectedBeta !== lp.foldBeta) {
        return {
          isValid: false,
          verifiedLayers: i,
          finalInputClaim: scClaim,
          reason: `Layer ${i} folding challenge mismatch`,
        };
      }

      transcript = digestHex('GKR_LAYER_END', [
        transcript,
        modField(lp.evalU).toString(16),
        modField(lp.evalV).toString(16),
        expectedAlpha.toString(16),
        expectedBeta.toString(16),
      ]);

      const eqU = buildEqTable(lp.pointU);
      const eqV = buildEqTable(lp.pointV);
      weights = eqU.map((eu, idx) =>
        modField(modField(expectedAlpha * eu) + modField(expectedBeta * eqV[idx]))
      );
      expectedClaim = modField(modField(expectedAlpha * lp.evalU) + modField(expectedBeta * lp.evalV));
    }

    if (transcript !== proof.transcriptDigest) {
      return {
        isValid: false,
        verifiedLayers: this.circuit.layers.length,
        finalInputClaim: expectedClaim,
        reason: 'Final GKR transcript digest mismatch',
      };
    }

    // Final input layer oracle check: sum_j weights[j] * inputs[j] == expectedClaim
    const inputSize = 1 << this.circuit.inputBits;
    if (inputs.length !== inputSize) {
      return {
        isValid: false,
        verifiedLayers: this.circuit.layers.length,
        finalInputClaim: expectedClaim,
        reason: 'Circuit input length mismatch',
      };
    }
    let oracleInputClaim = 0n;
    for (let j = 0; j < inputSize; j++) {
      oracleInputClaim = modField(oracleInputClaim + modField(weights[j] * modField(inputs[j])));
    }

    if (oracleInputClaim !== expectedClaim) {
      return {
        isValid: false,
        verifiedLayers: this.circuit.layers.length,
        finalInputClaim: expectedClaim,
        reason: 'Final input MLE evaluation does not match folded GKR claim',
      };
    }

    return {
      isValid: true,
      verifiedLayers: this.circuit.layers.length,
      finalInputClaim: expectedClaim,
    };
  }
}
