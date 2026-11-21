import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Multi-Auditor Distributed State Attestation Quorum Prover.
 *
 * Implements an independent multi-auditor attestation & discrepancy resolution engine:
 *  - Registered external auditors (each with Schnorr signing key and reputation weight)
 *    independently compute and sign state root attestations for an audit epoch
 *  - Aggregates incoming attestations by rootHash, isolates invalid/duplicate signatures,
 *    detects dissenting/diverging root claims across auditors (raising a DiscrepancyReport),
 *    and seals a canonical SupermajorityAuditCertificate once >= 2/3 weight agrees on ONE root!
 *  - Supports chained multi-epoch audit certificate verification from genesis!
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

export interface AuditorProfile {
  auditorId: string;
  weight: bigint;
  publicKey: bigint;
}

export interface AuditorSigner extends AuditorProfile {
  secretKey: bigint;
}

export interface RootAttestation {
  scopeId: string;
  epoch: number;
  auditorId: string;
  claimedStateRoot: string;
  previousCertHash: string;
  sigR: bigint;
  sigS: bigint;
}

export interface DiscrepancyDetail {
  claimedRoot: string;
  supportingAuditors: string[];
  supportingWeight: bigint;
}

export interface SupermajorityAuditCertificate {
  scopeId: string;
  epoch: number;
  agreedStateRoot: string;
  previousCertHash: string;
  agreedWeight: bigint;
  totalRegistryWeight: bigint;
  attestations: RootAttestation[];
  dissentingRoots: DiscrepancyDetail[];
  certificateHash: string;
}

export class VerifiableDistributedAuditQuorumProver {
  public readonly scopeId: string;
  public readonly genesisCertHash: string;
  private auditors = new Map<string, AuditorProfile>();

  constructor(scopeId: string) {
    this.scopeId = scopeId;
    this.genesisCertHash = sha256Hex('AUDIT-QUORUM-GENESIS-V1', scopeId);
  }

  public registerAuditor(auditorId: string, weight: bigint): AuditorSigner {
    if (this.auditors.has(auditorId)) throw new Error(`Auditor "${auditorId}" already registered`);
    if (weight <= 0n) throw new RangeError('Auditor weight must be positive');
    const secretKey = randomScalar();
    const publicKey = modPow(BASE_G, secretKey, SAFE_PRIME_P);
    const profile: AuditorProfile = { auditorId, weight, publicKey };
    this.auditors.set(auditorId, profile);
    return { ...profile, secretKey };
  }

  public getTotalWeight(): bigint {
    let total = 0n;
    for (const a of this.auditors.values()) total += a.weight;
    return total;
  }

  public getQuorumWeight(): bigint {
    return (this.getTotalWeight() * 2n) / 3n + 1n;
  }

  public computeAttestationDigest(epoch: number, claimedStateRoot: string, previousCertHash: string): string {
    return sha256Hex('AUDIT-QUORUM-ATT-V1', this.scopeId, String(epoch), claimedStateRoot, previousCertHash);
  }

  public signAttestation(
    signer: AuditorSigner,
    epoch: number,
    claimedStateRoot: string,
    previousCertHash: string,
  ): RootAttestation {
    const digest = this.computeAttestationDigest(epoch, claimedStateRoot, previousCertHash);
    const k = randomScalar();
    const sigR = modPow(BASE_G, k, SAFE_PRIME_P);
    const c = hashToScalar('AUDIT-QUORUM-SIG-V1', sigR.toString(16), signer.publicKey.toString(16), digest);
    return {
      scopeId: this.scopeId,
      epoch,
      auditorId: signer.auditorId,
      claimedStateRoot,
      previousCertHash,
      sigR,
      sigS: modScalar(k + c * signer.secretKey),
    };
  }

  public verifyAttestation(att: RootAttestation): boolean {
    if (att.scopeId !== this.scopeId || att.epoch < 0) return false;
    const rec = this.auditors.get(att.auditorId);
    if (!rec) return false;
    const digest = this.computeAttestationDigest(att.epoch, att.claimedStateRoot, att.previousCertHash);
    const c = hashToScalar('AUDIT-QUORUM-SIG-V1', att.sigR.toString(16), rec.publicKey.toString(16), digest);
    return modPow(BASE_G, att.sigS, SAFE_PRIME_P) === (att.sigR * modPow(rec.publicKey, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  private computeCertHash(
    epoch: number,
    agreedStateRoot: string,
    previousCertHash: string,
    attestations: RootAttestation[],
  ): string {
    const sortedSigs = attestations.map((a) => `${a.auditorId}:${a.sigR.toString(16)}:${a.sigS.toString(16)}`).sort();
    return sha256Hex('AUDIT-QUORUM-CERT-V1', this.scopeId, String(epoch), agreedStateRoot, previousCertHash, ...sortedSigs);
  }

  public finalizeEpochAudit(
    epoch: number,
    previousCertHash: string,
    submissions: RootAttestation[],
  ): {
    certificate: SupermajorityAuditCertificate | null;
    invalidAuditorIds: string[];
    rootBreakdown: DiscrepancyDetail[];
  } {
    const seen = new Set<string>();
    const invalidAuditorIds: string[] = [];
    const byRoot = new Map<string, { attestations: RootAttestation[]; weight: bigint }>();

    for (const sub of submissions) {
      if (
        sub.epoch !== epoch ||
        sub.previousCertHash !== previousCertHash ||
        seen.has(sub.auditorId) ||
        !this.verifyAttestation(sub)
      ) {
        invalidAuditorIds.push(sub.auditorId);
        continue;
      }
      seen.add(sub.auditorId);
      const rec = this.auditors.get(sub.auditorId)!;
      const bucket = byRoot.get(sub.claimedStateRoot) ?? { attestations: [], weight: 0n };
      bucket.attestations.push(sub);
      bucket.weight += rec.weight;
      byRoot.set(sub.claimedStateRoot, bucket);
    }

    const rootBreakdown: DiscrepancyDetail[] = [...byRoot.entries()]
      .map(([claimedRoot, info]) => ({
        claimedRoot,
        supportingAuditors: info.attestations.map((a) => a.auditorId).sort(),
        supportingWeight: info.weight,
      }))
      .sort((a, b) => (a.supportingWeight > b.supportingWeight ? -1 : a.supportingWeight < b.supportingWeight ? 1 : 0));

    const quorum = this.getQuorumWeight();
    const winner = rootBreakdown.find((r) => r.supportingWeight >= quorum);
    if (!winner) {
      return { certificate: null, invalidAuditorIds, rootBreakdown };
    }

    const winningAtts = byRoot.get(winner.claimedRoot)!.attestations;
    const dissentingRoots = rootBreakdown.filter((r) => r.claimedRoot !== winner.claimedRoot);
    const certificateHash = this.computeCertHash(epoch, winner.claimedRoot, previousCertHash, winningAtts);

    return {
      certificate: {
        scopeId: this.scopeId,
        epoch,
        agreedStateRoot: winner.claimedRoot,
        previousCertHash,
        agreedWeight: winner.supportingWeight,
        totalRegistryWeight: this.getTotalWeight(),
        attestations: winningAtts,
        dissentingRoots,
        certificateHash,
      },
      invalidAuditorIds,
      rootBreakdown,
    };
  }

  public verifyCertificate(cert: SupermajorityAuditCertificate): boolean {
    if (cert.scopeId !== this.scopeId || cert.epoch < 0) return false;
    if (this.computeCertHash(cert.epoch, cert.agreedStateRoot, cert.previousCertHash, cert.attestations) !== cert.certificateHash) {
      return false;
    }

    const seen = new Set<string>();
    let weight = 0n;
    for (const att of cert.attestations) {
      if (
        att.epoch !== cert.epoch ||
        att.claimedStateRoot !== cert.agreedStateRoot ||
        att.previousCertHash !== cert.previousCertHash ||
        seen.has(att.auditorId) ||
        !this.verifyAttestation(att)
      ) {
        return false;
      }
      seen.add(att.auditorId);
      weight += this.auditors.get(att.auditorId)!.weight;
    }

    return weight === cert.agreedWeight && weight >= this.getQuorumWeight();
  }

  public verifyAuditChain(certs: SupermajorityAuditCertificate[]): boolean {
    if (certs.length === 0) return false;
    let expectedPrev = this.genesisCertHash;
    for (let i = 0; i < certs.length; i++) {
      const c = certs[i];
      if (c.epoch !== i || c.previousCertHash !== expectedPrev) return false;
      if (!this.verifyCertificate(c)) return false;
      expectedPrev = c.certificateHash;
    }
    return true;
  }

  public serializeCertificate(cert: SupermajorityAuditCertificate): string {
    return JSON.stringify({
      scopeId: cert.scopeId,
      epoch: cert.epoch,
      agreedStateRoot: cert.agreedStateRoot,
      agreedWeight: cert.agreedWeight.toString(),
      dissentCount: cert.dissentingRoots.length,
      certificateHash: cert.certificateHash,
    });
  }
}
