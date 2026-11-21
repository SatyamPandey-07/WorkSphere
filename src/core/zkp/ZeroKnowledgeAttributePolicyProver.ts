import { createHash, randomBytes } from 'node:crypto';

/**
 * Zero-Knowledge Attribute Policy (K-of-N Threshold Access Control) Prover.
 *
 * Implements privacy-preserving attribute-based access control using Pedersen commitments
 * and Cramer-Damgard-Schoenmakers (CDS) K-of-N zero-knowledge disjunction proofs:
 *  - A policy specifies N eligible attribute predicates P_0, ..., P_{N-1} and a threshold K.
 *  - Each predicate has an issuer-committed public attestation key Y_i = g^{sk_i} mod P.
 *  - A user holding ANY K valid attribute secrets {sk_j} constructs a single K-of-N CDS
 *    threshold Sigma proof via degree-(N - K) Shamir challenge interpolation over F_Q!
 *  - Real branches (size K) compute honest Schnorr responses; simulated branches (size N - K)
 *    are interpolated cleanly onto a degree-(N - K) challenge polynomial f(x) whose f(0) = e
 *    equals the Fiat-Shamir root challenge!
 *  - Verifier confirms the user satisfies AT LEAST K of the N policy attributes WITHOUT
 *    learning WHICH K attributes the user possesses!
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

export interface PolicyAttributeSlot {
  attributeId: string;
  publicKey: bigint;
}

export interface AttributeWitness {
  attributeId: string;
  secretKey: bigint;
}

export interface AccessPolicy {
  policyId: string;
  thresholdK: number;
  slots: PolicyAttributeSlot[];
}

export interface BranchTranscript {
  attributeId: string;
  announcementR: bigint;
  challenge: bigint;
  response: bigint;
}

export interface AttributePolicyProof {
  policyId: string;
  thresholdK: number;
  resourceContext: string;
  rootChallenge: bigint;
  challengePolyCoeffs: bigint[]; // degree N - K polynomial f(x) with f(0) == rootChallenge
  branches: BranchTranscript[];
}

export class ZeroKnowledgeAttributePolicyProver {
  public issueAttributeCredential(attributeId: string, secret?: bigint): { slot: PolicyAttributeSlot; witness: AttributeWitness } {
    const secretKey = secret !== undefined ? modScalar(secret) : randomScalar();
    if (secretKey === 0n) throw new Error('Attribute secret must be non-zero');
    return {
      slot: { attributeId, publicKey: modPow(BASE_G, secretKey, SAFE_PRIME_P) },
      witness: { attributeId, secretKey },
    };
  }

  public createPolicy(policyId: string, thresholdK: number, slots: PolicyAttributeSlot[]): AccessPolicy {
    if (slots.length === 0) throw new Error('Policy must have at least one attribute slot');
    if (thresholdK < 1 || thresholdK > slots.length) {
      throw new RangeError('thresholdK must be in [1, slots.length]');
    }
    const ids = new Set(slots.map((s) => s.attributeId));
    if (ids.size !== slots.length) throw new Error('Duplicate attributeIds in policy');
    return { policyId, thresholdK, slots: [...slots] };
  }

  private evalPoly(coeffs: bigint[], x: bigint): bigint {
    let acc = 0n;
    let xp = 1n;
    for (const c of coeffs) {
      acc = modScalar(acc + c * xp);
      xp = modScalar(xp * x);
    }
    return acc;
  }

  private interpolatePoly(points: Array<{ x: bigint; y: bigint }>): bigint[] {
    const n = points.length;
    const out = new Array<bigint>(n).fill(0n);
    for (let i = 0; i < n; i++) {
      const xi = modScalar(points[i].x);
      const yi = modScalar(points[i].y);
      let basis = [1n];
      let denom = 1n;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const xj = modScalar(points[j].x);
        denom = modScalar(denom * modScalar(xi - xj));
        const next = new Array<bigint>(basis.length + 1).fill(0n);
        for (let k = 0; k < basis.length; k++) {
          next[k] = modScalar(next[k] - basis[k] * xj);
          next[k + 1] = modScalar(next[k + 1] + basis[k]);
        }
        basis = next;
      }
      const scale = modScalar(yi * modInv(denom, SUBGROUP_Q));
      for (let k = 0; k < basis.length; k++) {
        out[k] = modScalar(out[k] + basis[k] * scale);
      }
    }
    return out;
  }

  private computeRootChallenge(policy: AccessPolicy, resourceContext: string, announcements: bigint[]): bigint {
    return hashToScalar(
      'ZK-ATTR-POLICY-CDS-V1',
      policy.policyId,
      String(policy.thresholdK),
      resourceContext,
      ...policy.slots.map((s) => `${s.attributeId}:${s.publicKey.toString(16)}`),
      ...announcements.map((r) => r.toString(16)),
    );
  }

  public provePolicySatisfaction(
    policy: AccessPolicy,
    witnesses: AttributeWitness[],
    resourceContext = 'access-default',
  ): AttributePolicyProof {
    const n = policy.slots.length;
    const k = policy.thresholdK;
    const witnessMap = new Map<string, bigint>();
    for (const w of witnesses) {
      witnessMap.set(w.attributeId, modScalar(w.secretKey));
    }

    // Identify valid satisfied slot indices
    const satisfiedIndices: number[] = [];
    for (let i = 0; i < n; i++) {
      const slot = policy.slots[i];
      const sk = witnessMap.get(slot.attributeId);
      if (sk !== undefined && modPow(BASE_G, sk, SAFE_PRIME_P) === slot.publicKey) {
        satisfiedIndices.push(i);
      }
    }

    if (satisfiedIndices.length < k) {
      throw new Error(`Insufficient valid attribute witnesses: have ${satisfiedIndices.length}, require ${k}`);
    }

    // Pick exactly K real branches and (N - K) simulated branches
    const realSet = new Set<number>(satisfiedIndices.slice(0, k));
    const realNonces = new Map<number, bigint>();
    const simChallenges = new Map<number, bigint>();
    const simResponses = new Map<number, bigint>();
    const announcements = new Array<bigint>(n);

    for (let i = 0; i < n; i++) {
      if (realSet.has(i)) {
        const nonce = randomScalar();
        realNonces.set(i, nonce);
        announcements[i] = modPow(BASE_G, nonce, SAFE_PRIME_P);
      } else {
        const ci = randomScalar();
        const si = randomScalar();
        simChallenges.set(i, ci);
        simResponses.set(i, si);
        // R_i = g^{s_i} * Y_i^{-c_i} mod P
        announcements[i] = (
          modPow(BASE_G, si, SAFE_PRIME_P) *
          modPow(policy.slots[i].publicKey, modScalar(SUBGROUP_Q - ci), SAFE_PRIME_P)
        ) % SAFE_PRIME_P;
      }
    }

    const rootChallenge = this.computeRootChallenge(policy, resourceContext, announcements);

    // Interpolate unique polynomial f(x) of degree (N - K) passing through:
    //   (0, rootChallenge) and (i + 1, simChallenge_i) for all (N - K) simulated branches!
    const interpPoints: Array<{ x: bigint; y: bigint }> = [{ x: 0n, y: rootChallenge }];
    for (let i = 0; i < n; i++) {
      if (!realSet.has(i)) {
        interpPoints.push({ x: BigInt(i + 1), y: simChallenges.get(i)! });
      }
    }
    const challengePolyCoeffs = this.interpolatePoly(interpPoints);

    const branches: BranchTranscript[] = [];
    for (let i = 0; i < n; i++) {
      const slot = policy.slots[i];
      if (realSet.has(i)) {
        const ci = this.evalPoly(challengePolyCoeffs, BigInt(i + 1));
        const sk = witnessMap.get(slot.attributeId)!;
        const si = modScalar(realNonces.get(i)! + ci * sk);
        branches.push({ attributeId: slot.attributeId, announcementR: announcements[i], challenge: ci, response: si });
      } else {
        branches.push({
          attributeId: slot.attributeId,
          announcementR: announcements[i],
          challenge: simChallenges.get(i)!,
          response: simResponses.get(i)!,
        });
      }
    }

    return {
      policyId: policy.policyId,
      thresholdK: k,
      resourceContext,
      rootChallenge,
      challengePolyCoeffs,
      branches,
    };
  }

  public verifyPolicyProof(policy: AccessPolicy, proof: AttributePolicyProof): boolean {
    const n = policy.slots.length;
    const expectedPolyLen = n - policy.thresholdK + 1;
    if (
      proof.policyId !== policy.policyId ||
      proof.thresholdK !== policy.thresholdK ||
      proof.branches.length !== n ||
      proof.challengePolyCoeffs.length !== expectedPolyLen
    ) {
      return false;
    }

    const expectedRoot = this.computeRootChallenge(
      policy,
      proof.resourceContext,
      proof.branches.map((b) => b.announcementR),
    );
    if (expectedRoot !== proof.rootChallenge) return false;
    if (modScalar(proof.challengePolyCoeffs[0]) !== proof.rootChallenge) return false;

    for (let i = 0; i < n; i++) {
      const slot = policy.slots[i];
      const br = proof.branches[i];
      if (br.attributeId !== slot.attributeId) return false;
      const expectedCi = this.evalPoly(proof.challengePolyCoeffs, BigInt(i + 1));
      if (expectedCi !== br.challenge) return false;

      const lhs = modPow(BASE_G, br.response, SAFE_PRIME_P);
      const rhs = (br.announcementR * modPow(slot.publicKey, br.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
      if (lhs !== rhs) return false;
    }

    return true;
  }

  public serializeProof(proof: AttributePolicyProof): string {
    return JSON.stringify({
      policyId: proof.policyId,
      thresholdK: proof.thresholdK,
      totalSlots: proof.branches.length,
      polyDegree: proof.challengePolyCoeffs.length - 1,
      resourceContext: proof.resourceContext,
    });
  }
}
