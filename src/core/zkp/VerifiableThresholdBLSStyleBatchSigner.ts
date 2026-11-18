import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Threshold Unique-Signature Batch Signer (BLS-Style DDH-Unique Aggregator).
 *
 * Implements (t, n) threshold unique deterministic signatures over a safe-prime subgroup:
 *  - Each signer j holds Shamir share s_j (public share Y_j = g^{s_j}) of group key x (Y = g^x)
 *  - For any message m, H = H2G(domain || m); unique partial signature is sigma_j = H^{s_j}
 *    paired with a Chaum-Pedersen DLEQ proof (log_g(Y_j) == log_H(sigma_j))
 *  - Lagrange combination of any t honest partials yields the EXACT SAME unique group
 *    signature sigma = H^x independent of which quorum subset signed!
 *  - Multi-message batch verification compresses N message-signature pairs [(m_i, sigma_i)]
 *    into a SINGLE folded verification equation via randomized small-exponent weights!
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
  const v = modScalar(BigInt('0x' + sha256Hex(...parts).slice(0, 32)));
  return v === 0n ? 1n : v;
}

export interface ThresholdSignerKey {
  id: number;
  secretShare: bigint;
  publicShare: bigint;
}

export interface UniqueThresholdGroup {
  groupId: string;
  threshold: number;
  groupPublicKey: bigint;
  signers: ThresholdSignerKey[];
}

export interface PartialUniqueSig {
  signerId: number;
  message: string;
  partialSigma: bigint;
  dleqA: bigint;
  dleqB: bigint;
  challenge: bigint;
  responseS: bigint;
}

export interface ThresholdUniqueSignature {
  groupId: string;
  message: string;
  messagePoint: bigint;
  signature: bigint; // H(m)^x (unique!)
  verifiedPartials: PartialUniqueSig[];
}

export interface MultiMessageBatchProof {
  groupId: string;
  items: Array<{ message: string; signature: bigint }>;
  foldingSeed: bigint;
  aggregateMessagePoint: bigint;
  aggregateSignature: bigint;
  // Quorum-certified proof that aggregateSignature == aggregateMessagePoint^x
  quorumPartials: Array<{
    signerId: number;
    aggPartial: bigint;
    dleqA: bigint;
    dleqB: bigint;
    challenge: bigint;
    responseS: bigint;
  }>;
}

export class VerifiableThresholdBLSStyleBatchSigner {
  public createGroup(groupId: string, threshold: number, signerIds: number[]): UniqueThresholdGroup {
    if (threshold < 2 || threshold > signerIds.length) {
      throw new RangeError('Threshold must be in [2, signerIds.length]');
    }
    const coeffs = Array.from({ length: threshold }, () => randomScalar());
    const groupPublicKey = modPow(BASE_G, coeffs[0], SAFE_PRIME_P);
    const signers: ThresholdSignerKey[] = signerIds.map((id) => {
      const x = BigInt(id);
      let s = 0n;
      let xp = 1n;
      for (const c of coeffs) {
        s = modScalar(s + c * xp);
        xp = modScalar(xp * x);
      }
      return { id, secretShare: s, publicShare: modPow(BASE_G, s, SAFE_PRIME_P) };
    });
    return { groupId, threshold, groupPublicKey, signers };
  }

  public hashMessageToSubgroup(groupId: string, message: string): bigint {
    const hex = sha256Hex('TH-UNIQUE-H2G-V1', groupId, message);
    const raw = (BigInt('0x' + hex.slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
    const qr = (raw * raw) % SAFE_PRIME_P;
    return qr === 1n ? BASE_G : qr;
  }

  public signPartial(group: UniqueThresholdGroup, signer: ThresholdSignerKey, message: string): PartialUniqueSig {
    const H = this.hashMessageToSubgroup(group.groupId, message);
    const partialSigma = modPow(H, signer.secretShare, SAFE_PRIME_P);
    const k = randomScalar();
    const dleqA = modPow(BASE_G, k, SAFE_PRIME_P);
    const dleqB = modPow(H, k, SAFE_PRIME_P);
    const challenge = hashToScalar(
      'TH-UNIQUE-PARTIAL-V1',
      group.groupId,
      String(signer.id),
      message,
      signer.publicShare.toString(16),
      H.toString(16),
      partialSigma.toString(16),
      dleqA.toString(16),
      dleqB.toString(16),
    );
    return {
      signerId: signer.id,
      message,
      partialSigma,
      dleqA,
      dleqB,
      challenge,
      responseS: modScalar(k + challenge * signer.secretShare),
    };
  }

  public verifyPartial(group: UniqueThresholdGroup, partial: PartialUniqueSig): boolean {
    const signer = group.signers.find((s) => s.id === partial.signerId);
    if (!signer) return false;
    const H = this.hashMessageToSubgroup(group.groupId, partial.message);
    const expectedC = hashToScalar(
      'TH-UNIQUE-PARTIAL-V1',
      group.groupId,
      String(partial.signerId),
      partial.message,
      signer.publicShare.toString(16),
      H.toString(16),
      partial.partialSigma.toString(16),
      partial.dleqA.toString(16),
      partial.dleqB.toString(16),
    );
    if (expectedC !== partial.challenge) return false;
    const eq1 = modPow(BASE_G, partial.responseS, SAFE_PRIME_P) ===
      (partial.dleqA * modPow(signer.publicShare, partial.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const eq2 = modPow(H, partial.responseS, SAFE_PRIME_P) ===
      (partial.dleqB * modPow(partial.partialSigma, partial.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return eq1 && eq2;
  }

  private lagrangeCombinePoints(items: Array<{ id: number; point: bigint }>): bigint {
    const ids = items.map((x) => x.id);
    let acc = 1n;
    for (const item of items) {
      const xi = BigInt(item.id);
      let num = 1n;
      let den = 1n;
      for (const other of ids) {
        if (other === item.id) continue;
        const xj = BigInt(other);
        num = modScalar(num * modScalar(SUBGROUP_Q - xj));
        den = modScalar(den * modScalar(xi - xj));
      }
      const lambda = modScalar(num * modInv(den, SUBGROUP_Q));
      acc = (acc * modPow(item.point, lambda, SAFE_PRIME_P)) % SAFE_PRIME_P;
    }
    return acc;
  }

  public aggregateSignature(
    group: UniqueThresholdGroup,
    message: string,
    partials: PartialUniqueSig[],
  ): { signature: ThresholdUniqueSignature | null; faultySignerIds: number[] } {
    const seen = new Set<number>();
    const valid: PartialUniqueSig[] = [];
    const faultySignerIds: number[] = [];

    for (const p of partials) {
      if (p.message !== message || seen.has(p.signerId) || !this.verifyPartial(group, p)) {
        faultySignerIds.push(p.signerId);
      } else {
        seen.add(p.signerId);
        valid.push(p);
      }
    }

    if (valid.length < group.threshold) return { signature: null, faultySignerIds };

    const quorum = valid.slice(0, group.threshold);
    const sig = this.lagrangeCombinePoints(quorum.map((q) => ({ id: q.signerId, point: q.partialSigma })));
    return {
      signature: {
        groupId: group.groupId,
        message,
        messagePoint: this.hashMessageToSubgroup(group.groupId, message),
        signature: sig,
        verifiedPartials: quorum,
      },
      faultySignerIds,
    };
  }

  public verifyThresholdSignature(group: UniqueThresholdGroup, sig: ThresholdUniqueSignature): boolean {
    if (sig.groupId !== group.groupId || sig.verifiedPartials.length < group.threshold) return false;
    if (this.hashMessageToSubgroup(group.groupId, sig.message) !== sig.messagePoint) return false;
    const seen = new Set<number>();
    for (const p of sig.verifiedPartials) {
      if (p.message !== sig.message || seen.has(p.signerId) || !this.verifyPartial(group, p)) return false;
      seen.add(p.signerId);
    }
    const recomputed = this.lagrangeCombinePoints(
      sig.verifiedPartials.slice(0, group.threshold).map((q) => ({ id: q.signerId, point: q.partialSigma })),
    );
    return recomputed === sig.signature;
  }

  public createMultiMessageBatchProof(
    group: UniqueThresholdGroup,
    quorumSigners: ThresholdSignerKey[],
    sigs: ThresholdUniqueSignature[],
  ): MultiMessageBatchProof {
    if (sigs.length === 0 || quorumSigners.length < group.threshold) {
      throw new Error('Need non-empty signature list and threshold quorum signers');
    }
    const items = sigs.map((s) => ({ message: s.message, signature: s.signature }));
    const foldingSeed = hashToScalar(
      'TH-UNIQUE-BATCH-SEED-V1',
      group.groupId,
      ...items.map((it) => `${it.message}:${it.signature.toString(16)}`),
    );

    let aggregateMessagePoint = 1n;
    let aggregateSignature = 1n;
    let w = 1n;
    for (const it of items) {
      const H = this.hashMessageToSubgroup(group.groupId, it.message);
      aggregateMessagePoint = (aggregateMessagePoint * modPow(H, w, SAFE_PRIME_P)) % SAFE_PRIME_P;
      aggregateSignature = (aggregateSignature * modPow(it.signature, w, SAFE_PRIME_P)) % SAFE_PRIME_P;
      w = modScalar(w * foldingSeed);
    }

    const quorumPartials = quorumSigners.slice(0, group.threshold).map((signer) => {
      const aggPartial = modPow(aggregateMessagePoint, signer.secretShare, SAFE_PRIME_P);
      const k = randomScalar();
      const dleqA = modPow(BASE_G, k, SAFE_PRIME_P);
      const dleqB = modPow(aggregateMessagePoint, k, SAFE_PRIME_P);
      const challenge = hashToScalar(
        'TH-UNIQUE-BATCH-DLEQ-V1',
        group.groupId,
        String(signer.id),
        foldingSeed.toString(16),
        aggregateMessagePoint.toString(16),
        aggPartial.toString(16),
        dleqA.toString(16),
        dleqB.toString(16),
      );
      return {
        signerId: signer.id,
        aggPartial,
        dleqA,
        dleqB,
        challenge,
        responseS: modScalar(k + challenge * signer.secretShare),
      };
    });

    return { groupId: group.groupId, items, foldingSeed, aggregateMessagePoint, aggregateSignature, quorumPartials };
  }

  public verifyMultiMessageBatchProof(group: UniqueThresholdGroup, proof: MultiMessageBatchProof): boolean {
    if (proof.groupId !== group.groupId || proof.items.length === 0 || proof.quorumPartials.length < group.threshold) {
      return false;
    }
    const expectedSeed = hashToScalar(
      'TH-UNIQUE-BATCH-SEED-V1',
      group.groupId,
      ...proof.items.map((it) => `${it.message}:${it.signature.toString(16)}`),
    );
    if (expectedSeed !== proof.foldingSeed) return false;

    let expM = 1n;
    let expSig = 1n;
    let w = 1n;
    for (const it of proof.items) {
      expM = (expM * modPow(this.hashMessageToSubgroup(group.groupId, it.message), w, SAFE_PRIME_P)) % SAFE_PRIME_P;
      expSig = (expSig * modPow(it.signature, w, SAFE_PRIME_P)) % SAFE_PRIME_P;
      w = modScalar(w * proof.foldingSeed);
    }
    if (expM !== proof.aggregateMessagePoint || expSig !== proof.aggregateSignature) return false;

    const seen = new Set<number>();
    for (const qp of proof.quorumPartials) {
      const signer = group.signers.find((s) => s.id === qp.signerId);
      if (!signer || seen.has(qp.signerId)) return false;
      const expectedC = hashToScalar(
        'TH-UNIQUE-BATCH-DLEQ-V1',
        group.groupId,
        String(qp.signerId),
        proof.foldingSeed.toString(16),
        proof.aggregateMessagePoint.toString(16),
        qp.aggPartial.toString(16),
        qp.dleqA.toString(16),
        qp.dleqB.toString(16),
      );
      if (expectedC !== qp.challenge) return false;
      const eq1 = modPow(BASE_G, qp.responseS, SAFE_PRIME_P) ===
        (qp.dleqA * modPow(signer.publicShare, qp.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
      const eq2 = modPow(proof.aggregateMessagePoint, qp.responseS, SAFE_PRIME_P) ===
        (qp.dleqB * modPow(qp.aggPartial, qp.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
      if (!eq1 || !eq2) return false;
      seen.add(qp.signerId);
    }

    const combined = this.lagrangeCombinePoints(
      proof.quorumPartials.slice(0, group.threshold).map((qp) => ({ id: qp.signerId, point: qp.aggPartial })),
    );
    return combined === proof.aggregateSignature;
  }

  public serializeBatchProof(proof: MultiMessageBatchProof): string {
    return JSON.stringify({
      groupId: proof.groupId,
      messageCount: proof.items.length,
      quorumCount: proof.quorumPartials.length,
    });
  }
}
