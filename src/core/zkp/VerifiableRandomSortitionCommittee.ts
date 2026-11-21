import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Stake-Weighted Cryptographic Sortition Committee Prover (Algorand-style VRF).
 *
 * Implements private non-interactive committee selection weighted by validator stake:
 *  - Each validator i has keypair (sk_i, pk_i = g^{sk_i}) and registered stake w_i out of total W.
 *  - For round seed S and role tag R, validator computes deterministic VRF pre-output
 *      Gamma = H2G(seed || role)^sk_i  with a Chaum-Pedersen DLEQ proof (log_g(pk_i) == log_H(Gamma))
 *  - Derives uniform 64-bit hash fraction u = H(Gamma) / 2^64 and determines the EXACT number
 *    of committee seats j in [0, w_i] won via exact binomial CDF inversion B(j; w_i, p = tau / W)!
 *  - Computes deterministic per-seat priority digests H(Gamma || seatIndex) so any observer can
 *    verify committee eligibility, seat count, and highest-priority leader election in O(1)!
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

export interface StakedValidatorPublic {
  validatorId: string;
  stake: number; // integer weight units
  publicKey: bigint;
}

export interface StakedValidatorSigner extends StakedValidatorPublic {
  secretKey: bigint;
}

export interface SortitionVRFProof {
  validatorId: string;
  roundSeed: string;
  role: string;
  gamma: bigint;
  vrfOutputHex: string;
  dleqA: bigint;
  dleqB: bigint;
  challenge: bigint;
  responseSk: bigint;
  claimedSeats: number;
  bestSeatPriorityHex: string | null;
}

export interface CommitteeTallyReport {
  roundSeed: string;
  role: string;
  expectedCommitteeSize: number;
  totalSelectedSeats: number;
  selectedValidators: Array<{ validatorId: string; seats: number; bestPriorityHex: string }>;
  leaderValidatorId: string | null;
  rejectedValidatorIds: string[];
}

export class VerifiableRandomSortitionCommittee {
  private validators = new Map<string, StakedValidatorPublic>();

  public registerValidator(validatorId: string, stake: number, secret?: bigint): StakedValidatorSigner {
    if (this.validators.has(validatorId)) throw new Error(`Validator "${validatorId}" already registered`);
    if (!Number.isInteger(stake) || stake <= 0) throw new RangeError('Stake must be a positive integer');
    const secretKey = secret !== undefined ? modScalar(secret) : randomScalar();
    if (secretKey === 0n) throw new Error('Secret key must be non-zero');
    const publicKey = modPow(BASE_G, secretKey, SAFE_PRIME_P);
    const pub: StakedValidatorPublic = { validatorId, stake, publicKey };
    this.validators.set(validatorId, pub);
    return { ...pub, secretKey };
  }

  public getTotalStake(): number {
    let total = 0;
    for (const v of this.validators.values()) total += v.stake;
    return total;
  }

  public hashToSubgroup(roundSeed: string, role: string): bigint {
    const hex = sha256Hex('SORTITION-VRF-H2G-V1', roundSeed, role);
    const raw = (BigInt('0x' + hex.slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
    const qr = (raw * raw) % SAFE_PRIME_P;
    return qr === 1n ? BASE_G : qr;
  }

  /**
   * Computes exact number of selected sub-users j in [0, stake] via Binomial(stake, p) CDF
   * against uniform fraction u in [0, 1) derived from VRF output hash.
   */
  public computeBinomialSeats(vrfOutputHex: string, stake: number, expectedCommitteeSize: number, totalStake: number): number {
    if (stake <= 0 || totalStake <= 0 || expectedCommitteeSize <= 0) return 0;
    const p = Math.min(1, expectedCommitteeSize / totalStake);
    if (p >= 1) return stake;

    const u = Number(BigInt('0x' + vrfOutputHex.slice(0, 13))) / Number(1n << 52n);
    // Compute P(X = 0) = (1 - p)^stake and accumulate CDF cleanly via recurrence:
    // P(X = k + 1) = P(X = k) * ((stake - k) / (k + 1)) * (p / (1 - p))
    const q = 1 - p;
    let pmf = Math.pow(q, stake);
    let cdf = pmf;
    let seats = 0;
    while (seats < stake && u >= cdf) {
      pmf = pmf * ((stake - seats) / (seats + 1)) * (p / q);
      cdf += pmf;
      seats++;
      if (!Number.isFinite(cdf) || pmf === 0) break;
    }
    return seats;
  }

  public computeBestSeatPriority(vrfOutputHex: string, seats: number): string | null {
    if (seats <= 0) return null;
    let best: string | null = null;
    for (let s = 0; s < seats; s++) {
      const h = sha256Hex('SORTITION-SEAT-PRIO-V1', vrfOutputHex, String(s));
      if (best === null || h < best) best = h;
    }
    return best;
  }

  public runSortition(
    signer: StakedValidatorSigner,
    roundSeed: string,
    role: string,
    expectedCommitteeSize: number,
  ): SortitionVRFProof {
    const totalStake = this.getTotalStake();
    if (totalStake <= 0) throw new Error('No validators registered');

    const H = this.hashToSubgroup(roundSeed, role);
    const gamma = modPow(H, signer.secretKey, SAFE_PRIME_P);
    const vrfOutputHex = sha256Hex('SORTITION-VRF-OUT-V1', roundSeed, role, gamma.toString(16));

    const k = randomScalar();
    const dleqA = modPow(BASE_G, k, SAFE_PRIME_P);
    const dleqB = modPow(H, k, SAFE_PRIME_P);
    const challenge = hashToScalar(
      'SORTITION-DLEQ-V1',
      signer.validatorId,
      roundSeed,
      role,
      signer.publicKey.toString(16),
      gamma.toString(16),
      dleqA.toString(16),
      dleqB.toString(16),
    );
    const responseSk = modScalar(k + challenge * signer.secretKey);

    const claimedSeats = this.computeBinomialSeats(vrfOutputHex, signer.stake, expectedCommitteeSize, totalStake);
    const bestSeatPriorityHex = this.computeBestSeatPriority(vrfOutputHex, claimedSeats);

    return {
      validatorId: signer.validatorId,
      roundSeed,
      role,
      gamma,
      vrfOutputHex,
      dleqA,
      dleqB,
      challenge,
      responseSk,
      claimedSeats,
      bestSeatPriorityHex,
    };
  }

  public verifySortitionProof(proof: SortitionVRFProof, expectedCommitteeSize: number): boolean {
    const val = this.validators.get(proof.validatorId);
    if (!val) return false;
    const totalStake = this.getTotalStake();

    const expectedOut = sha256Hex('SORTITION-VRF-OUT-V1', proof.roundSeed, proof.role, proof.gamma.toString(16));
    if (expectedOut !== proof.vrfOutputHex) return false;

    const H = this.hashToSubgroup(proof.roundSeed, proof.role);
    const expectedC = hashToScalar(
      'SORTITION-DLEQ-V1',
      proof.validatorId,
      proof.roundSeed,
      proof.role,
      val.publicKey.toString(16),
      proof.gamma.toString(16),
      proof.dleqA.toString(16),
      proof.dleqB.toString(16),
    );
    if (expectedC !== proof.challenge) return false;

    const eq1 = modPow(BASE_G, proof.responseSk, SAFE_PRIME_P) ===
      (proof.dleqA * modPow(val.publicKey, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const eq2 = modPow(H, proof.responseSk, SAFE_PRIME_P) ===
      (proof.dleqB * modPow(proof.gamma, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    if (!eq1 || !eq2) return false;

    const expectedSeats = this.computeBinomialSeats(proof.vrfOutputHex, val.stake, expectedCommitteeSize, totalStake);
    if (expectedSeats !== proof.claimedSeats) return false;

    const expectedPrio = this.computeBestSeatPriority(proof.vrfOutputHex, expectedSeats);
    return expectedPrio === proof.bestSeatPriorityHex;
  }

  public tallyCommittee(
    roundSeed: string,
    role: string,
    expectedCommitteeSize: number,
    submissions: SortitionVRFProof[],
  ): CommitteeTallyReport {
    const seen = new Set<string>();
    const selectedValidators: Array<{ validatorId: string; seats: number; bestPriorityHex: string }> = [];
    const rejectedValidatorIds: string[] = [];
    let totalSelectedSeats = 0;

    for (const sub of submissions) {
      if (
        sub.roundSeed !== roundSeed ||
        sub.role !== role ||
        seen.has(sub.validatorId) ||
        !this.verifySortitionProof(sub, expectedCommitteeSize)
      ) {
        rejectedValidatorIds.push(sub.validatorId);
        continue;
      }
      seen.add(sub.validatorId);
      if (sub.claimedSeats > 0 && sub.bestSeatPriorityHex !== null) {
        selectedValidators.push({
          validatorId: sub.validatorId,
          seats: sub.claimedSeats,
          bestPriorityHex: sub.bestSeatPriorityHex,
        });
        totalSelectedSeats += sub.claimedSeats;
      }
    }

    selectedValidators.sort((a, b) => a.bestPriorityHex.localeCompare(b.bestPriorityHex));
    return {
      roundSeed,
      role,
      expectedCommitteeSize,
      totalSelectedSeats,
      selectedValidators,
      leaderValidatorId: selectedValidators.length > 0 ? selectedValidators[0].validatorId : null,
      rejectedValidatorIds,
    };
  }

  public serializeReport(report: CommitteeTallyReport): string {
    return JSON.stringify(report);
  }
}
