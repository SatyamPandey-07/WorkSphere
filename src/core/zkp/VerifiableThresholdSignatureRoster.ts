import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Threshold Validator Roster & Epoch Handoff Prover.
 *
 * Implements light-client-verifiable dynamic validator set transitions across epochs:
 *  - Each epoch E defines a canonical sorted roster R_E = [(id, weight, publicKey)] and a
 *    roster root hash H(R_E) + quorum threshold Q_E (> 2/3 total weight).
 *  - To rotate from epoch E to epoch E+1, a supermajority of epoch E's validators sign the
 *    handoff statement binding (chainId, E -> E+1, H(R_E), H(R_{E+1}), stateRoot).
 *  - Light clients anchored ONLY to genesis roster hash H(R_0) verify an arbitrary chain of
 *    epoch handoffs [0 -> 1 -> ... -> K] without downloading intermediate blocks!
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

export interface RosterMemberPublic {
  id: string;
  weight: bigint;
  publicKey: bigint;
}

export interface RosterMemberSigner extends RosterMemberPublic {
  secretKey: bigint;
}

export interface EpochRoster {
  chainId: string;
  epoch: number;
  members: RosterMemberPublic[];
  totalWeight: bigint;
  quorumWeight: bigint;
  rosterHash: string;
}

export interface HandoffApproval {
  validatorId: string;
  sigR: bigint;
  sigS: bigint;
}

export interface EpochHandoffCertificate {
  chainId: string;
  fromEpoch: number;
  toEpoch: number;
  fromRosterHash: string;
  nextRoster: EpochRoster;
  stateAnchorHash: string;
  approvals: HandoffApproval[];
  signedWeight: bigint;
}

export class VerifiableThresholdSignatureRoster {
  public createMember(id: string, weight: bigint): RosterMemberSigner {
    if (weight <= 0n) throw new RangeError('Member weight must be positive');
    const secretKey = randomScalar();
    return { id, weight, secretKey, publicKey: modPow(BASE_G, secretKey, SAFE_PRIME_P) };
  }

  public computeRosterHash(chainId: string, epoch: number, members: RosterMemberPublic[]): string {
    const canonical = [...members]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((m) => `${m.id}:${m.weight.toString()}:${m.publicKey.toString(16)}`);
    return sha256Hex('ROSTER-V1', chainId, String(epoch), ...canonical);
  }

  public buildRoster(chainId: string, epoch: number, members: RosterMemberPublic[]): EpochRoster {
    if (members.length === 0) throw new Error('Roster cannot be empty');
    const ids = new Set<string>();
    let totalWeight = 0n;
    for (const m of members) {
      if (ids.has(m.id)) throw new Error(`Duplicate roster member "${m.id}"`);
      if (m.weight <= 0n) throw new RangeError('Roster weights must be positive');
      ids.add(m.id);
      totalWeight += m.weight;
    }
    const quorumWeight = (totalWeight * 2n) / 3n + 1n;
    const publicMembers = members.map(({ id, weight, publicKey }) => ({ id, weight, publicKey }));
    return {
      chainId,
      epoch,
      members: publicMembers,
      totalWeight,
      quorumWeight,
      rosterHash: this.computeRosterHash(chainId, epoch, publicMembers),
    };
  }

  private handoffDigest(
    chainId: string,
    fromEpoch: number,
    toEpoch: number,
    fromRosterHash: string,
    toRosterHash: string,
    stateAnchorHash: string,
  ): string {
    return sha256Hex(
      'ROSTER-HANDOFF-V1',
      chainId,
      String(fromEpoch),
      String(toEpoch),
      fromRosterHash,
      toRosterHash,
      stateAnchorHash,
    );
  }

  private signDigest(signer: RosterMemberSigner, digest: string): HandoffApproval {
    const k = randomScalar();
    const sigR = modPow(BASE_G, k, SAFE_PRIME_P);
    const c = hashToScalar('ROSTER-SIG-V1', sigR.toString(16), signer.publicKey.toString(16), digest);
    const sigS = modScalar(k + c * signer.secretKey);
    return { validatorId: signer.id, sigR, sigS };
  }

  private verifyApproval(pubKey: bigint, digest: string, app: HandoffApproval): boolean {
    const c = hashToScalar('ROSTER-SIG-V1', app.sigR.toString(16), pubKey.toString(16), digest);
    return modPow(BASE_G, app.sigS, SAFE_PRIME_P) === (app.sigR * modPow(pubKey, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  public createHandoffCertificate(
    currentRoster: EpochRoster,
    nextRoster: EpochRoster,
    signers: RosterMemberSigner[],
    stateAnchorHash: string,
  ): { certificate: EpochHandoffCertificate | null; rejectedIds: string[] } {
    if (nextRoster.chainId !== currentRoster.chainId || nextRoster.epoch !== currentRoster.epoch + 1) {
      throw new Error('Next roster must match chainId and increment epoch by 1');
    }
    const digest = this.handoffDigest(
      currentRoster.chainId,
      currentRoster.epoch,
      nextRoster.epoch,
      currentRoster.rosterHash,
      nextRoster.rosterHash,
      stateAnchorHash,
    );

    const memberMap = new Map(currentRoster.members.map((m) => [m.id, m]));
    const seen = new Set<string>();
    const approvals: HandoffApproval[] = [];
    const rejectedIds: string[] = [];
    let signedWeight = 0n;

    for (const signer of signers) {
      const rec = memberMap.get(signer.id);
      if (!rec || seen.has(signer.id) || rec.publicKey !== signer.publicKey) {
        rejectedIds.push(signer.id);
        continue;
      }
      const app = this.signDigest(signer, digest);
      seen.add(signer.id);
      approvals.push(app);
      signedWeight += rec.weight;
    }

    if (signedWeight < currentRoster.quorumWeight) {
      return { certificate: null, rejectedIds };
    }

    return {
      certificate: {
        chainId: currentRoster.chainId,
        fromEpoch: currentRoster.epoch,
        toEpoch: nextRoster.epoch,
        fromRosterHash: currentRoster.rosterHash,
        nextRoster,
        stateAnchorHash,
        approvals,
        signedWeight,
      },
      rejectedIds,
    };
  }

  public verifyHandoff(currentRoster: EpochRoster, cert: EpochHandoffCertificate): boolean {
    if (
      cert.chainId !== currentRoster.chainId ||
      cert.fromEpoch !== currentRoster.epoch ||
      cert.toEpoch !== currentRoster.epoch + 1 ||
      cert.fromRosterHash !== currentRoster.rosterHash
    ) {
      return false;
    }
    const recomputedNextHash = this.computeRosterHash(cert.nextRoster.chainId, cert.nextRoster.epoch, cert.nextRoster.members);
    if (recomputedNextHash !== cert.nextRoster.rosterHash) return false;

    const digest = this.handoffDigest(
      cert.chainId,
      cert.fromEpoch,
      cert.toEpoch,
      cert.fromRosterHash,
      cert.nextRoster.rosterHash,
      cert.stateAnchorHash,
    );

    const memberMap = new Map(currentRoster.members.map((m) => [m.id, m]));
    const seen = new Set<string>();
    let weight = 0n;
    for (const app of cert.approvals) {
      const rec = memberMap.get(app.validatorId);
      if (!rec || seen.has(app.validatorId)) return false;
      if (!this.verifyApproval(rec.publicKey, digest, app)) return false;
      seen.add(app.validatorId);
      weight += rec.weight;
    }

    return weight === cert.signedWeight && weight >= currentRoster.quorumWeight;
  }

  public verifyEpochChain(genesisRoster: EpochRoster, certificates: EpochHandoffCertificate[]): { valid: boolean; finalRoster: EpochRoster } {
    let active = genesisRoster;
    for (const cert of certificates) {
      if (!this.verifyHandoff(active, cert)) {
        return { valid: false, finalRoster: active };
      }
      active = cert.nextRoster;
    }
    return { valid: true, finalRoster: active };
  }

  public serializeCertificate(cert: EpochHandoffCertificate): string {
    return JSON.stringify({
      chainId: cert.chainId,
      fromEpoch: cert.fromEpoch,
      toEpoch: cert.toEpoch,
      signedWeight: cert.signedWeight.toString(),
      nextRosterHash: cert.nextRoster.rosterHash,
    });
  }
}
