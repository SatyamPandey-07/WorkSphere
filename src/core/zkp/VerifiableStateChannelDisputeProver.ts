import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable State Channel Dispute & Settlement Prover.
 *
 * Implements a cryptographic 2-party off-chain payment/state channel with:
 *  - Schnorr co-signed monotonically-increasing state updates (nonce, balanceA, balanceB)
 *  - Zero-knowledge Pedersen balance conservation proof:
 *      C_A * C_B = g^{totalDeposit} * h^{r_A + r_B}
 *    so external dispute watchers verify solvency without seeing private balances until close
 *  - Fraud-proof dispute resolution: submitting a newer co-signed state (nonce_new > nonce_stale)
 *    cryptographically supersedes a malicious stale settlement claim and penalizes the cheater
 *  - Cooperative close proof with instant finality.
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

function deriveH(): bigint {
  const raw = (BigInt('0x' + sha256Hex('STATE-CHANNEL-H-V1').slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
  const qr = (raw * raw) % SAFE_PRIME_P;
  return qr === 1n || qr === BASE_G ? 9n : qr;
}

export const BASE_H = deriveH();

export interface ChannelParticipantKeys {
  id: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface SchnorrSig {
  R: bigint;
  s: bigint;
}

export interface ConservationProof {
  announcementR: bigint;
  challenge: bigint;
  responseBlinding: bigint;
}

export interface ChannelConfig {
  channelId: string;
  partyAPublicKey: bigint;
  partyBPublicKey: bigint;
  totalDeposit: bigint;
  disputeWindowBlocks: number;
}

export interface SignedChannelState {
  channelId: string;
  nonce: number;
  commitmentA: bigint;
  commitmentB: bigint;
  stateRootHash: string;
  conservationProof: ConservationProof;
  sigA: SchnorrSig;
  sigB: SchnorrSig;
  isFinal: boolean;
}

export interface DisputeChallengeResult {
  disputeResolved: boolean;
  supersededStaleNonce: number;
  winningNonce: number;
  slashedParty?: 'A' | 'B';
  reason: string;
}

export class VerifiableStateChannelDisputeProver {
  public generateKeys(id: string): ChannelParticipantKeys {
    const secretKey = randomScalar();
    return {
      id,
      secretKey,
      publicKey: modPow(BASE_G, secretKey, SAFE_PRIME_P),
    };
  }

  private signDigest(secretKey: bigint, publicKey: bigint, digest: string): SchnorrSig {
    const k = randomScalar();
    const R = modPow(BASE_G, k, SAFE_PRIME_P);
    const c = hashToScalar('CHANNEL-SIG-V1', R.toString(16), publicKey.toString(16), digest);
    const s = modScalar(k + c * secretKey);
    return { R, s };
  }

  private verifyDigest(publicKey: bigint, digest: string, sig: SchnorrSig): boolean {
    const c = hashToScalar('CHANNEL-SIG-V1', sig.R.toString(16), publicKey.toString(16), digest);
    const lhs = modPow(BASE_G, sig.s, SAFE_PRIME_P);
    const rhs = (sig.R * modPow(publicKey, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return lhs === rhs;
  }

  private computeStateDigest(
    channelId: string,
    nonce: number,
    commitmentA: bigint,
    commitmentB: bigint,
    isFinal: boolean,
  ): string {
    return sha256Hex(
      'CHANNEL-STATE-V1',
      channelId,
      String(nonce),
      commitmentA.toString(16),
      commitmentB.toString(16),
      isFinal ? 'FINAL' : 'ACTIVE',
    );
  }

  private proveConservation(
    channelId: string,
    nonce: number,
    totalDeposit: bigint,
    combinedComm: bigint,
    combinedBlinding: bigint,
  ): ConservationProof {
    const k = randomScalar();
    const announcementR = modPow(BASE_H, k, SAFE_PRIME_P);
    const challenge = hashToScalar(
      'CHANNEL-CONSERVATION-V1',
      channelId,
      String(nonce),
      totalDeposit.toString(16),
      combinedComm.toString(16),
      announcementR.toString(16),
    );
    const responseBlinding = modScalar(k + challenge * combinedBlinding);
    return { announcementR, challenge, responseBlinding };
  }

  private verifyConservation(
    channelId: string,
    nonce: number,
    totalDeposit: bigint,
    commitmentA: bigint,
    commitmentB: bigint,
    proof: ConservationProof,
  ): boolean {
    const combinedComm = (commitmentA * commitmentB) % SAFE_PRIME_P;
    const expectedC = hashToScalar(
      'CHANNEL-CONSERVATION-V1',
      channelId,
      String(nonce),
      totalDeposit.toString(16),
      combinedComm.toString(16),
      proof.announcementR.toString(16),
    );
    if (expectedC !== proof.challenge) return false;
    const gNegTotal = modPow(BASE_G, modScalar(SUBGROUP_Q - modScalar(totalDeposit)), SAFE_PRIME_P);
    const target = (combinedComm * gNegTotal) % SAFE_PRIME_P;
    const lhs = modPow(BASE_H, proof.responseBlinding, SAFE_PRIME_P);
    const rhs = (proof.announcementR * modPow(target, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return lhs === rhs;
  }

  public createSignedState(
    config: ChannelConfig,
    keysA: ChannelParticipantKeys,
    keysB: ChannelParticipantKeys,
    nonce: number,
    balanceA: bigint,
    balanceB: bigint,
    isFinal = false,
  ): SignedChannelState {
    if (nonce < 0) throw new RangeError('Nonce must be non-negative');
    if (balanceA < 0n || balanceB < 0n || balanceA + balanceB !== config.totalDeposit) {
      throw new RangeError('Balances must be non-negative and conserve totalDeposit');
    }
    const rA = randomScalar();
    const rB = randomScalar();
    const commitmentA = (modPow(BASE_G, balanceA, SAFE_PRIME_P) * modPow(BASE_H, rA, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const commitmentB = (modPow(BASE_G, balanceB, SAFE_PRIME_P) * modPow(BASE_H, rB, SAFE_PRIME_P)) % SAFE_PRIME_P;

    const combinedComm = (commitmentA * commitmentB) % SAFE_PRIME_P;
    const conservationProof = this.proveConservation(
      config.channelId,
      nonce,
      config.totalDeposit,
      combinedComm,
      modScalar(rA + rB),
    );

    const stateRootHash = this.computeStateDigest(config.channelId, nonce, commitmentA, commitmentB, isFinal);
    const sigA = this.signDigest(keysA.secretKey, keysA.publicKey, stateRootHash);
    const sigB = this.signDigest(keysB.secretKey, keysB.publicKey, stateRootHash);

    return {
      channelId: config.channelId,
      nonce,
      commitmentA,
      commitmentB,
      stateRootHash,
      conservationProof,
      sigA,
      sigB,
      isFinal,
    };
  }

  public verifySignedState(config: ChannelConfig, state: SignedChannelState): boolean {
    if (state.channelId !== config.channelId || state.nonce < 0) return false;
    const expectedDigest = this.computeStateDigest(
      state.channelId,
      state.nonce,
      state.commitmentA,
      state.commitmentB,
      state.isFinal,
    );
    if (expectedDigest !== state.stateRootHash) return false;
    if (!this.verifyConservation(config.channelId, state.nonce, config.totalDeposit, state.commitmentA, state.commitmentB, state.conservationProof)) {
      return false;
    }
    if (!this.verifyDigest(config.partyAPublicKey, state.stateRootHash, state.sigA)) return false;
    return this.verifyDigest(config.partyBPublicKey, state.stateRootHash, state.sigB);
  }

  public adjudicateDispute(
    config: ChannelConfig,
    claimedState: SignedChannelState,
    challengerState: SignedChannelState,
    claimant: 'A' | 'B',
    submittedBlock: number,
    challengeBlock: number,
  ): DisputeChallengeResult {
    if (!this.verifySignedState(config, claimedState)) {
      return {
        disputeResolved: false,
        supersededStaleNonce: claimedState.nonce,
        winningNonce: -1,
        reason: 'Claimed state failed cryptographic verification',
      };
    }
    if (!this.verifySignedState(config, challengerState)) {
      return {
        disputeResolved: false,
        supersededStaleNonce: claimedState.nonce,
        winningNonce: claimedState.nonce,
        reason: 'Challenger state failed cryptographic verification',
      };
    }
    if (challengeBlock - submittedBlock > config.disputeWindowBlocks) {
      return {
        disputeResolved: false,
        supersededStaleNonce: claimedState.nonce,
        winningNonce: claimedState.nonce,
        reason: 'Dispute challenge arrived after challenge window expired',
      };
    }
    if (challengerState.nonce > claimedState.nonce) {
      return {
        disputeResolved: true,
        supersededStaleNonce: claimedState.nonce,
        winningNonce: challengerState.nonce,
        slashedParty: claimant,
        reason: `Fraud proven: newer co-signed nonce ${challengerState.nonce} supersedes stale nonce ${claimedState.nonce}`,
      };
    }
    return {
      disputeResolved: false,
      supersededStaleNonce: claimedState.nonce,
      winningNonce: claimedState.nonce,
      reason: 'Challenger state does not have a strictly higher nonce',
    };
  }

  public serializeState(state: SignedChannelState): string {
    return JSON.stringify({
      channelId: state.channelId,
      nonce: state.nonce,
      commitmentA: state.commitmentA.toString(16),
      commitmentB: state.commitmentB.toString(16),
      stateRootHash: state.stateRootHash,
      isFinal: state.isFinal,
    });
  }
}
