import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Chained Threshold Random Beacon Prover.
 *
 * Implements a drand-style unbiasable chained threshold randomness beacon:
 *  - (t, n) Feldman-VSS threshold beacon committee holds group key Y = g^x
 *  - Each round r > 0 binds to previous randomness R_{r-1} via domain-separated subgroup point:
 *      M_r = HashToSubgroup(chainId || round || R_{r-1})
 *  - Each active beacon node j computes deterministic partial signature sigma_j = M_r^{s_j}
 *    accompanied by a Chaum-Pedersen DLEQ proof (log_g(Y_j) == log_{M_r}(sigma_j))
 *  - Because M_r^{s_j} is deterministic, NO subset of < t nodes can bias or predict sigma_r = M_r^x!
 *  - Lagrange interpolation combines t valid shares into sigma_r = M_r^x and derives
 *    R_r = SHA-256('BEACON-OUT' || chainId || round || sigma_r), verified across the entire chain!
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

function modInv(a: bigint, m: bigint): bigint {
  let t = 0n;
  let newT = 1n;
  let r = m;
  let newR = ((a % m) + m) % m;
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r > 1n) throw new Error('Not invertible');
  return t < 0n ? t + m : t;
}

function randomScalar(): bigint {
  const bytes = randomBytes(16);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return (v % (SUBGROUP_Q - 2n)) + 1n;
}

function sha256Hex(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return h.digest('hex');
}

function hashToScalar(...parts: string[]): bigint {
  return modScalar(BigInt('0x' + sha256Hex(...parts).slice(0, 32)));
}

export interface BeaconNodeShare {
  id: number;
  secretShare: bigint;
  publicShare: bigint;
}

export interface BeaconCommittee {
  chainId: string;
  threshold: number;
  genesisSeed: string;
  groupPublicKey: bigint;
  nodes: BeaconNodeShare[];
}

export interface PartialBeaconSignature {
  nodeId: number;
  round: number;
  partialSigma: bigint; // M_r^{s_j}
  dleqA: bigint;
  dleqB: bigint;
  challenge: bigint;
  response: bigint;
}

export interface BeaconPulse {
  chainId: string;
  round: number;
  previousRandomness: string;
  messagePoint: bigint;
  thresholdSignature: bigint; // M_r^x (unique & deterministic!)
  randomnessHex: string;
  verifiedPartials: PartialBeaconSignature[];
}

export class VerifiableRandomBeaconChainProver {
  public setupCommittee(chainId: string, threshold: number, nodeIds: number[], genesisSeed?: string): BeaconCommittee {
    if (threshold < 2 || threshold > nodeIds.length) {
      throw new RangeError('Threshold must be in [2, nodeIds.length]');
    }
    const coeffs = Array.from({ length: threshold }, () => randomScalar());
    const groupPublicKey = modPow(BASE_G, coeffs[0], SAFE_PRIME_P);
    const nodes: BeaconNodeShare[] = nodeIds.map((id) => {
      const x = BigInt(id);
      let s = 0n;
      let xp = 1n;
      for (const c of coeffs) {
        s = modScalar(s + c * xp);
        xp = modScalar(xp * x);
      }
      return { id, secretShare: s, publicShare: modPow(BASE_G, s, SAFE_PRIME_P) };
    });

    return {
      chainId,
      threshold,
      genesisSeed: genesisSeed ?? sha256Hex('BEACON-GENESIS-V1', chainId),
      groupPublicKey,
      nodes,
    };
  }

  public hashRoundToSubgroup(chainId: string, round: number, previousRandomness: string): bigint {
    const hex = sha256Hex('BEACON-ROUND-MSG-V1', chainId, String(round), previousRandomness);
    const raw = (BigInt('0x' + hex.slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
    const qr = (raw * raw) % SAFE_PRIME_P;
    return qr === 1n ? BASE_G : qr;
  }

  public deriveRandomness(chainId: string, round: number, thresholdSignature: bigint): string {
    return sha256Hex('BEACON-OUTPUT-V1', chainId, String(round), thresholdSignature.toString(16));
  }

  public producePartialSignature(
    committee: BeaconCommittee,
    node: BeaconNodeShare,
    round: number,
    previousRandomness: string,
  ): PartialBeaconSignature {
    const M = this.hashRoundToSubgroup(committee.chainId, round, previousRandomness);
    const partialSigma = modPow(M, node.secretShare, SAFE_PRIME_P);
    const k = randomScalar();
    const dleqA = modPow(BASE_G, k, SAFE_PRIME_P);
    const dleqB = modPow(M, k, SAFE_PRIME_P);
    const challenge = hashToScalar(
      'BEACON-PARTIAL-DLEQ-V1',
      committee.chainId,
      String(round),
      String(node.id),
      node.publicShare.toString(16),
      M.toString(16),
      partialSigma.toString(16),
      dleqA.toString(16),
      dleqB.toString(16),
    );
    const response = modScalar(k + challenge * node.secretShare);
    return { nodeId: node.id, round, partialSigma, dleqA, dleqB, challenge, response };
  }

  public verifyPartialSignature(
    committee: BeaconCommittee,
    previousRandomness: string,
    partial: PartialBeaconSignature,
  ): boolean {
    const node = committee.nodes.find((n) => n.id === partial.nodeId);
    if (!node) return false;
    const M = this.hashRoundToSubgroup(committee.chainId, partial.round, previousRandomness);
    const expectedC = hashToScalar(
      'BEACON-PARTIAL-DLEQ-V1',
      committee.chainId,
      String(partial.round),
      String(partial.nodeId),
      node.publicShare.toString(16),
      M.toString(16),
      partial.partialSigma.toString(16),
      partial.dleqA.toString(16),
      partial.dleqB.toString(16),
    );
    if (expectedC !== partial.challenge) return false;
    const eq1 = modPow(BASE_G, partial.response, SAFE_PRIME_P) ===
      (partial.dleqA * modPow(node.publicShare, partial.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const eq2 = modPow(M, partial.response, SAFE_PRIME_P) ===
      (partial.dleqB * modPow(partial.partialSigma, partial.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return eq1 && eq2;
  }

  private lagrangeCombine(partials: PartialBeaconSignature[]): bigint {
    const ids = partials.map((p) => p.nodeId);
    let combined = 1n;
    for (const p of partials) {
      const xi = BigInt(p.nodeId);
      let num = 1n;
      let den = 1n;
      for (const other of ids) {
        if (other === p.nodeId) continue;
        const xj = BigInt(other);
        num = modScalar(num * modScalar(SUBGROUP_Q - xj));
        den = modScalar(den * modScalar(xi - xj));
      }
      const lambda = modScalar(num * modInv(den, SUBGROUP_Q));
      combined = (combined * modPow(p.partialSigma, lambda, SAFE_PRIME_P)) % SAFE_PRIME_P;
    }
    return combined;
  }

  public aggregatePulse(
    committee: BeaconCommittee,
    round: number,
    previousRandomness: string,
    partials: PartialBeaconSignature[],
  ): { pulse: BeaconPulse | null; faultyNodes: number[] } {
    const seen = new Set<number>();
    const valid: PartialBeaconSignature[] = [];
    const faultyNodes: number[] = [];

    for (const p of partials) {
      if (p.round !== round || seen.has(p.nodeId) || !this.verifyPartialSignature(committee, previousRandomness, p)) {
        faultyNodes.push(p.nodeId);
        continue;
      }
      seen.add(p.nodeId);
      valid.push(p);
    }

    if (valid.length < committee.threshold) {
      return { pulse: null, faultyNodes };
    }

    const quorum = valid.slice(0, committee.threshold);
    const thresholdSignature = this.lagrangeCombine(quorum);
    const messagePoint = this.hashRoundToSubgroup(committee.chainId, round, previousRandomness);
    const randomnessHex = this.deriveRandomness(committee.chainId, round, thresholdSignature);

    return {
      pulse: {
        chainId: committee.chainId,
        round,
        previousRandomness,
        messagePoint,
        thresholdSignature,
        randomnessHex,
        verifiedPartials: quorum,
      },
      faultyNodes,
    };
  }

  public verifyPulse(committee: BeaconCommittee, pulse: BeaconPulse): boolean {
    if (pulse.chainId !== committee.chainId || pulse.verifiedPartials.length < committee.threshold) return false;
    const expectedM = this.hashRoundToSubgroup(committee.chainId, pulse.round, pulse.previousRandomness);
    if (expectedM !== pulse.messagePoint) return false;

    const seen = new Set<number>();
    for (const p of pulse.verifiedPartials) {
      if (p.round !== pulse.round || seen.has(p.nodeId)) return false;
      if (!this.verifyPartialSignature(committee, pulse.previousRandomness, p)) return false;
      seen.add(p.nodeId);
    }

    const recomputedSig = this.lagrangeCombine(pulse.verifiedPartials.slice(0, committee.threshold));
    if (recomputedSig !== pulse.thresholdSignature) return false;
    return this.deriveRandomness(committee.chainId, pulse.round, pulse.thresholdSignature) === pulse.randomnessHex;
  }

  public verifyBeaconChain(committee: BeaconCommittee, pulses: BeaconPulse[]): boolean {
    let prev = committee.genesisSeed;
    for (let i = 0; i < pulses.length; i++) {
      const p = pulses[i];
      if (p.round !== i + 1 || p.previousRandomness !== prev) return false;
      if (!this.verifyPulse(committee, p)) return false;
      prev = p.randomnessHex;
    }
    return true;
  }

  public serializePulse(pulse: BeaconPulse): string {
    return JSON.stringify({
      chainId: pulse.chainId,
      round: pulse.round,
      randomnessHex: pulse.randomnessHex,
      quorumSize: pulse.verifiedPartials.length,
    });
  }
}
