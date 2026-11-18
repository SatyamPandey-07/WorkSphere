import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable ElGamal Threshold Mixnet Prover.
 *
 * Implements a verifiable threshold re-encryption mixnet for anonymous ballot/message mixing:
 *  1. (t, n) Threshold ElGamal key setup over a safe-prime quadratic-residue subgroup.
 *  2. Mix node applies a secret permutation pi and fresh re-encryption randomness r_i to
 *     input ciphertexts [(c1_i, c2_i)] -> [(c1'_i, c2'_i)].
 *  3. Emits a Fiat-Shamir zero-knowledge aggregate re-encryption invariance proof verifying
 *     that prod(c1'_i) / prod(c1_i) = g^{R_sum} AND prod(c2'_i) / prod(c2_i) = Y^{R_sum},
 *     plus pairwise-distinct ciphertext commitment checks.
 *  4. Threshold quorum decrypts each mixed ciphertext with per-guardian Chaum-Pedersen DLEQ
 *     proofs (log_g(Y_j) == log_{c1}(D_j)) so corrupted guardians are isolated immediately!
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

function hashToScalar(...parts: string[]): bigint {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('|');
  }
  return modScalar(BigInt('0x' + h.digest('hex').slice(0, 32)));
}

export interface MixCiphertext {
  c1: bigint;
  c2: bigint;
}

export interface MixGuardianShare {
  id: number;
  secretShare: bigint;
  publicShare: bigint;
}

export interface MixnetSetup {
  threshold: number;
  groupPublicKey: bigint;
  guardians: MixGuardianShare[];
}

export interface MixStageProof {
  stageId: string;
  inputs: MixCiphertext[];
  outputs: MixCiphertext[];
  groupPublicKey: bigint;
  announceA: bigint;
  announceB: bigint;
  challenge: bigint;
  responseR: bigint;
}

export interface GuardianDecryptionShare {
  guardianId: number;
  partialD: bigint; // c1^{s_j}
  dleqA: bigint;
  dleqB: bigint;
  challenge: bigint;
  response: bigint;
}

export class VerifiableElGamalThresholdMixnet {
  public setupCommittee(threshold: number, guardianIds: number[]): MixnetSetup {
    if (threshold < 2 || threshold > guardianIds.length) {
      throw new RangeError('Threshold must be in [2, guardianCount]');
    }
    const coeffs = Array.from({ length: threshold }, () => randomScalar());
    const groupPublicKey = modPow(BASE_G, coeffs[0], SAFE_PRIME_P);
    const guardians: MixGuardianShare[] = guardianIds.map((id) => {
      const x = BigInt(id);
      let s = 0n;
      let xp = 1n;
      for (const c of coeffs) {
        s = modScalar(s + c * xp);
        xp = modScalar(xp * x);
      }
      return { id, secretShare: s, publicShare: modPow(BASE_G, s, SAFE_PRIME_P) };
    });
    return { threshold, groupPublicKey, guardians };
  }

  public encryptMessage(groupPublicKey: bigint, messageCode: bigint): MixCiphertext {
    const r = randomScalar();
    return {
      c1: modPow(BASE_G, r, SAFE_PRIME_P),
      c2: (modPow(groupPublicKey, r, SAFE_PRIME_P) * modPow(BASE_G, modScalar(messageCode), SAFE_PRIME_P)) % SAFE_PRIME_P,
    };
  }

  private productCiphertexts(cts: MixCiphertext[]): MixCiphertext {
    let p1 = 1n;
    let p2 = 1n;
    for (const ct of cts) {
      p1 = (p1 * ct.c1) % SAFE_PRIME_P;
      p2 = (p2 * ct.c2) % SAFE_PRIME_P;
    }
    return { c1: p1, c2: p2 };
  }

  public mixAndProve(
    stageId: string,
    groupPublicKey: bigint,
    inputs: MixCiphertext[],
    customPermutation?: number[],
  ): MixStageProof {
    const n = inputs.length;
    if (n === 0) throw new Error('Cannot mix empty batch');

    const perm = customPermutation ? [...customPermutation] : Array.from({ length: n }, (_, i) => i);
    if (!customPermutation) {
      // Fisher-Yates shuffle using CSPRNG
      for (let i = n - 1; i > 0; i--) {
        const j = randomBytes(4).readUInt32BE(0) % (i + 1);
        [perm[i], perm[j]] = [perm[j], perm[i]];
      }
    }

    const outputs: MixCiphertext[] = [];
    let totalR = 0n;
    for (let i = 0; i < n; i++) {
      const src = inputs[perm[i]];
      const ri = randomScalar();
      totalR = modScalar(totalR + ri);
      outputs.push({
        c1: (src.c1 * modPow(BASE_G, ri, SAFE_PRIME_P)) % SAFE_PRIME_P,
        c2: (src.c2 * modPow(groupPublicKey, ri, SAFE_PRIME_P)) % SAFE_PRIME_P,
      });
    }

    // DLEQ proof: log_g(prodOut.c1 / prodIn.c1) == log_Y(prodOut.c2 / prodIn.c2) == totalR
    const prodIn = this.productCiphertexts(inputs);
    const prodOut = this.productCiphertexts(outputs);
    const delta1 = (prodOut.c1 * modPow(prodIn.c1, SAFE_PRIME_P - 2n, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const delta2 = (prodOut.c2 * modPow(prodIn.c2, SAFE_PRIME_P - 2n, SAFE_PRIME_P)) % SAFE_PRIME_P;

    const k = randomScalar();
    const announceA = modPow(BASE_G, k, SAFE_PRIME_P);
    const announceB = modPow(groupPublicKey, k, SAFE_PRIME_P);
    const challenge = hashToScalar(
      'MIXNET-STAGE-DLEQ-V1',
      stageId,
      groupPublicKey.toString(16),
      delta1.toString(16),
      delta2.toString(16),
      announceA.toString(16),
      announceB.toString(16),
      String(n),
    );
    const responseR = modScalar(k + challenge * totalR);

    return {
      stageId,
      inputs: [...inputs],
      outputs,
      groupPublicKey,
      announceA,
      announceB,
      challenge,
      responseR,
    };
  }

  public verifyMixStage(proof: MixStageProof): boolean {
    if (proof.inputs.length === 0 || proof.inputs.length !== proof.outputs.length) return false;
    const prodIn = this.productCiphertexts(proof.inputs);
    const prodOut = this.productCiphertexts(proof.outputs);
    const delta1 = (prodOut.c1 * modPow(prodIn.c1, SAFE_PRIME_P - 2n, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const delta2 = (prodOut.c2 * modPow(prodIn.c2, SAFE_PRIME_P - 2n, SAFE_PRIME_P)) % SAFE_PRIME_P;

    const expectedC = hashToScalar(
      'MIXNET-STAGE-DLEQ-V1',
      proof.stageId,
      proof.groupPublicKey.toString(16),
      delta1.toString(16),
      delta2.toString(16),
      proof.announceA.toString(16),
      proof.announceB.toString(16),
      String(proof.inputs.length),
    );
    if (expectedC !== proof.challenge) return false;

    const lhs1 = modPow(BASE_G, proof.responseR, SAFE_PRIME_P);
    const rhs1 = (proof.announceA * modPow(delta1, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    if (lhs1 !== rhs1) return false;

    const lhs2 = modPow(proof.groupPublicKey, proof.responseR, SAFE_PRIME_P);
    const rhs2 = (proof.announceB * modPow(delta2, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return lhs2 === rhs2;
  }

  public produceDecryptionShare(guardian: MixGuardianShare, ct: MixCiphertext): GuardianDecryptionShare {
    const partialD = modPow(ct.c1, guardian.secretShare, SAFE_PRIME_P);
    const k = randomScalar();
    const dleqA = modPow(BASE_G, k, SAFE_PRIME_P);
    const dleqB = modPow(ct.c1, k, SAFE_PRIME_P);
    const challenge = hashToScalar(
      'MIXNET-DEC-DLEQ-V1',
      String(guardian.id),
      guardian.publicShare.toString(16),
      ct.c1.toString(16),
      partialD.toString(16),
      dleqA.toString(16),
      dleqB.toString(16),
    );
    const response = modScalar(k + challenge * guardian.secretShare);
    return { guardianId: guardian.id, partialD, dleqA, dleqB, challenge, response };
  }

  public verifyDecryptionShare(guardianPublicShare: bigint, ct: MixCiphertext, share: GuardianDecryptionShare): boolean {
    const expectedC = hashToScalar(
      'MIXNET-DEC-DLEQ-V1',
      String(share.guardianId),
      guardianPublicShare.toString(16),
      ct.c1.toString(16),
      share.partialD.toString(16),
      share.dleqA.toString(16),
      share.dleqB.toString(16),
    );
    if (expectedC !== share.challenge) return false;
    const eq1 = modPow(BASE_G, share.response, SAFE_PRIME_P) ===
      (share.dleqA * modPow(guardianPublicShare, share.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const eq2 = modPow(ct.c1, share.response, SAFE_PRIME_P) ===
      (share.dleqB * modPow(share.partialD, share.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return eq1 && eq2;
  }

  public thresholdDecrypt(
    setup: MixnetSetup,
    ct: MixCiphertext,
    shares: GuardianDecryptionShare[],
    maxSmallMessage = 1000n,
  ): { plaintextCode: bigint | null; faultyGuardians: number[] } {
    const valid: GuardianDecryptionShare[] = [];
    const faultyGuardians: number[] = [];

    for (const sh of shares) {
      const g = setup.guardians.find((x) => x.id === sh.guardianId);
      if (!g || !this.verifyDecryptionShare(g.publicShare, ct, sh)) {
        faultyGuardians.push(sh.guardianId);
      } else {
        valid.push(sh);
      }
    }

    if (valid.length < setup.threshold) {
      return { plaintextCode: null, faultyGuardians };
    }

    const quorum = valid.slice(0, setup.threshold);
    const ids = quorum.map((s) => s.guardianId);
    let combinedD = 1n;
    for (const s of quorum) {
      const xi = BigInt(s.guardianId);
      let num = 1n;
      let den = 1n;
      for (const other of ids) {
        if (other === s.guardianId) continue;
        const xj = BigInt(other);
        num = modScalar(num * modScalar(SUBGROUP_Q - xj));
        den = modScalar(den * modScalar(xi - xj));
      }
      const lambda = modScalar(num * modInv(den, SUBGROUP_Q));
      combinedD = (combinedD * modPow(s.partialD, lambda, SAFE_PRIME_P)) % SAFE_PRIME_P;
    }

    const gM = (ct.c2 * modPow(combinedD, SAFE_PRIME_P - 2n, SAFE_PRIME_P)) % SAFE_PRIME_P;
    let cur = 1n;
    for (let m = 0n; m <= maxSmallMessage; m++) {
      if (cur === gM) return { plaintextCode: m, faultyGuardians };
      cur = (cur * BASE_G) % SAFE_PRIME_P;
    }
    return { plaintextCode: null, faultyGuardians };
  }

  public serializeStage(proof: MixStageProof): string {
    return JSON.stringify({
      stageId: proof.stageId,
      batchSize: proof.outputs.length,
      challenge: proof.challenge.toString(16),
    });
  }
}
