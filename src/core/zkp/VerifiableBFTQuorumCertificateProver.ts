import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable BFT Quorum Certificate & Two-Chain Finality Prover.
 *
 * Implements a stake-weighted Byzantine Fault Tolerant (HotStuff/Tendermint-style)
 * Quorum Certificate (QC) engine with:
 *  - Schnorr validator keypairs and stake-weighted registry (quorum >= ceil(2/3 * totalStake) + 1)
 *  - Deterministic vote digests binding (chainId, view, blockHash, parentHash)
 *  - QC aggregation with duplicate-vote rejection and invalid-signature fault isolation
 *  - Cryptographic equivocation (double-signing in the same view) fraud proof verification
 *  - Two-chain consecutive-view finality certificate verification.
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

export interface ValidatorRecord {
  id: string;
  stake: bigint;
  publicKey: bigint;
}

export interface ValidatorSigner extends ValidatorRecord {
  secretKey: bigint;
}

export interface BFTBlockHeader {
  chainId: string;
  view: number;
  height: number;
  blockHash: string;
  parentHash: string;
}

export interface ValidatorVote {
  validatorId: string;
  chainId: string;
  view: number;
  blockHash: string;
  parentHash: string;
  sigR: bigint;
  sigS: bigint;
}

export interface QuorumCertificate {
  chainId: string;
  view: number;
  blockHash: string;
  parentHash: string;
  votes: ValidatorVote[];
  signedStake: bigint;
  totalStake: bigint;
  qcDigest: string;
}

export interface EquivocationEvidence {
  validatorId: string;
  voteA: ValidatorVote;
  voteB: ValidatorVote;
}

export class VerifiableBFTQuorumCertificateProver {
  private validators = new Map<string, ValidatorRecord>();

  public createValidator(id: string, stake: bigint): ValidatorSigner {
    if (stake <= 0n) throw new RangeError('Validator stake must be positive');
    const secretKey = randomScalar();
    const publicKey = modPow(BASE_G, secretKey, SAFE_PRIME_P);
    const record: ValidatorRecord = { id, stake, publicKey };
    this.validators.set(id, record);
    return { ...record, secretKey };
  }

  public getTotalStake(): bigint {
    let total = 0n;
    for (const v of this.validators.values()) total += v.stake;
    return total;
  }

  public getQuorumThreshold(): bigint {
    const total = this.getTotalStake();
    return (total * 2n) / 3n + 1n;
  }

  public computeVoteDigest(chainId: string, view: number, blockHash: string, parentHash: string): string {
    return sha256Hex('BFT-VOTE-V1', chainId, String(view), blockHash, parentHash);
  }

  public signVote(signer: ValidatorSigner, block: BFTBlockHeader): ValidatorVote {
    const digest = this.computeVoteDigest(block.chainId, block.view, block.blockHash, block.parentHash);
    const k = randomScalar();
    const sigR = modPow(BASE_G, k, SAFE_PRIME_P);
    const c = hashToScalar('BFT-SCHNORR-V1', sigR.toString(16), signer.publicKey.toString(16), digest);
    const sigS = modScalar(k + c * signer.secretKey);
    return {
      validatorId: signer.id,
      chainId: block.chainId,
      view: block.view,
      blockHash: block.blockHash,
      parentHash: block.parentHash,
      sigR,
      sigS,
    };
  }

  public verifyVote(vote: ValidatorVote): boolean {
    const rec = this.validators.get(vote.validatorId);
    if (!rec) return false;
    const digest = this.computeVoteDigest(vote.chainId, vote.view, vote.blockHash, vote.parentHash);
    const c = hashToScalar('BFT-SCHNORR-V1', vote.sigR.toString(16), rec.publicKey.toString(16), digest);
    const lhs = modPow(BASE_G, vote.sigS, SAFE_PRIME_P);
    const rhs = (vote.sigR * modPow(rec.publicKey, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return lhs === rhs;
  }

  private computeQCDigest(chainId: string, view: number, blockHash: string, parentHash: string, votes: ValidatorVote[]): string {
    const sortedIds = [...votes].map((v) => `${v.validatorId}:${v.sigR.toString(16)}:${v.sigS.toString(16)}`).sort();
    return sha256Hex('BFT-QC-V1', chainId, String(view), blockHash, parentHash, ...sortedIds);
  }

  public formQuorumCertificate(
    block: BFTBlockHeader,
    candidateVotes: ValidatorVote[],
  ): { qc: QuorumCertificate | null; rejectedValidators: string[]; signedStake: bigint; requiredStake: bigint } {
    const seen = new Set<string>();
    const validVotes: ValidatorVote[] = [];
    const rejectedValidators: string[] = [];
    let signedStake = 0n;

    for (const vote of candidateVotes) {
      if (
        seen.has(vote.validatorId) ||
        vote.chainId !== block.chainId ||
        vote.view !== block.view ||
        vote.blockHash !== block.blockHash ||
        vote.parentHash !== block.parentHash ||
        !this.verifyVote(vote)
      ) {
        rejectedValidators.push(vote.validatorId);
        continue;
      }
      seen.add(vote.validatorId);
      validVotes.push(vote);
      signedStake += this.validators.get(vote.validatorId)!.stake;
    }

    const requiredStake = this.getQuorumThreshold();
    if (signedStake < requiredStake) {
      return { qc: null, rejectedValidators, signedStake, requiredStake };
    }

    const totalStake = this.getTotalStake();
    const qc: QuorumCertificate = {
      chainId: block.chainId,
      view: block.view,
      blockHash: block.blockHash,
      parentHash: block.parentHash,
      votes: validVotes,
      signedStake,
      totalStake,
      qcDigest: this.computeQCDigest(block.chainId, block.view, block.blockHash, block.parentHash, validVotes),
    };
    return { qc, rejectedValidators, signedStake, requiredStake };
  }

  public verifyQuorumCertificate(qc: QuorumCertificate): boolean {
    const expectedDigest = this.computeQCDigest(qc.chainId, qc.view, qc.blockHash, qc.parentHash, qc.votes);
    if (expectedDigest !== qc.qcDigest) return false;
    const seen = new Set<string>();
    let stake = 0n;
    for (const v of qc.votes) {
      if (seen.has(v.validatorId)) return false;
      if (v.chainId !== qc.chainId || v.view !== qc.view || v.blockHash !== qc.blockHash || v.parentHash !== qc.parentHash) {
        return false;
      }
      if (!this.verifyVote(v)) return false;
      seen.add(v.validatorId);
      stake += this.validators.get(v.validatorId)!.stake;
    }
    return stake === qc.signedStake && stake >= this.getQuorumThreshold();
  }

  public verifyTwoChainFinality(parentQC: QuorumCertificate, childQC: QuorumCertificate): boolean {
    if (!this.verifyQuorumCertificate(parentQC) || !this.verifyQuorumCertificate(childQC)) return false;
    if (parentQC.chainId !== childQC.chainId) return false;
    // Strict consecutive view and parent hash link
    return childQC.view === parentQC.view + 1 && childQC.parentHash === parentQC.blockHash;
  }

  public verifyEquivocationProof(evidence: EquivocationEvidence): boolean {
    const { validatorId, voteA, voteB } = evidence;
    if (voteA.validatorId !== validatorId || voteB.validatorId !== validatorId) return false;
    if (voteA.chainId !== voteB.chainId || voteA.view !== voteB.view) return false;
    if (voteA.blockHash === voteB.blockHash) return false;
    return this.verifyVote(voteA) && this.verifyVote(voteB);
  }

  public serializeQC(qc: QuorumCertificate): string {
    return JSON.stringify({
      chainId: qc.chainId,
      view: qc.view,
      blockHash: qc.blockHash,
      parentHash: qc.parentHash,
      signedStake: qc.signedStake.toString(),
      totalStake: qc.totalStake.toString(),
      signerCount: qc.votes.length,
      qcDigest: qc.qcDigest,
    });
  }
}
