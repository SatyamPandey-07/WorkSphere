/**
 * @file VerifiableChaumPedersenCredentialChain.ts
 * @description Multi-Hop Delegated Chaum-Pedersen Certificate Chain & Scoped Capability Attenuation
 * Verifier with Revocation Set Auditing and Portable JSON Serialization.
 * Allows Root CA -> Intermediate Org -> Department -> Service Account delegation chains where:
 *   1. Each delegation certificate carries a Schnorr signature from its parent key AND enforces
 *      strict capability attenuation (child scopes MUST be a subset of parent scopes!).
 *   2. Leaf holder proves active possession of the delegated leaf key via a bound Chaum-Pedersen
 *      challenge proof without disclosing any private key in the chain.
 *   3. Revoking ANY intermediate or leaf certificate immediately invalidates all descendant proofs!
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface ChainEntityKey {
  entityId: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface DelegatedCertificate {
  certId: string;
  issuerId: string;
  subjectId: string;
  issuerPublicKey: bigint;
  subjectPublicKey: bigint;
  grantedScopes: string[];
  expiresAtEpoch: number;
  sigR: bigint;
  sigS: bigint;
  certDigest: string;
}

export interface DelegatedInvocationProof {
  invocationId: string;
  requestedScope: string;
  currentEpoch: number;
  rootPublicKey: bigint;
  certificateChain: DelegatedCertificate[];
  challengeNonce: string;
  leafProofR: bigint;
  leafProofS: bigint;
  invocationDigest: string;
}

function modNorm(a: bigint, m: bigint): bigint {
  const r = a % m;
  return r >= 0n ? r : r + m;
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = modNorm(base, mod);
  let e = exp;
  while (e > 0n) {
    if ((e & 1n) === 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

function randomScalar(q: bigint): bigint {
  return (BigInt(`0x${randomBytes(16).toString('hex')}`) % (q - 2n)) + 2n;
}

function hashScalar(domain: string, parts: readonly (string | bigint)[]): bigint {
  const h = createHash('sha256');
  h.update(domain);
  for (const part of parts) {
    h.update('|');
    h.update(typeof part === 'bigint' ? part.toString(16) : part);
  }
  return (BigInt(`0x${h.digest('hex')}`) % (SUBGROUP_Q - 1n)) + 1n;
}

/**
 * Multi-Hop Attenuated Delegation Certificate Chain & Invocation Verifier.
 */
export class VerifiableChaumPedersenCredentialChain {
  private readonly p: bigint;
  private readonly q: bigint;
  private readonly g: bigint;
  private readonly revokedCertIds: Set<string> = new Set();

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q, g = BASE_G) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
    this.g = g;
  }

  public generateEntityKey(entityId: string, seedSecret?: bigint): ChainEntityKey {
    const secretKey = seedSecret !== undefined
      ? modNorm(seedSecret, this.q - 2n) + 2n
      : randomScalar(this.q);
    return {
      entityId,
      secretKey,
      publicKey: modPow(this.g, secretKey, this.p),
    };
  }

  private computeCertChallenge(
    certId: string,
    issuerId: string,
    subjectId: string,
    issuerPub: bigint,
    subjectPub: bigint,
    scopes: readonly string[],
    expiresAtEpoch: number,
    sigR: bigint
  ): bigint {
    return hashScalar('WorkSphere::DelegCertSig', [
      certId,
      issuerId,
      subjectId,
      issuerPub,
      subjectPub,
      scopes.join(','),
      BigInt(expiresAtEpoch),
      sigR,
    ]);
  }

  /**
   * Issues a signed delegation certificate from `issuer` to `subjectPublicKey` for sorted `grantedScopes`.
   */
  public issueCertificate(
    certId: string,
    issuer: ChainEntityKey,
    subjectId: string,
    subjectPublicKey: bigint,
    grantedScopes: readonly string[],
    expiresAtEpoch: number
  ): DelegatedCertificate {
    if (grantedScopes.length === 0) throw new Error('Delegation must grant at least one scope');
    const sortedScopes = Array.from(new Set(grantedScopes)).sort();

    const k = randomScalar(this.q);
    const sigR = modPow(this.g, k, this.p);
    const e = this.computeCertChallenge(
      certId,
      issuer.entityId,
      subjectId,
      issuer.publicKey,
      subjectPublicKey,
      sortedScopes,
      expiresAtEpoch,
      sigR
    );
    const sigS = modNorm(k + e * issuer.secretKey, this.q);

    const certDigest = createHash('sha256')
      .update(`${certId}|${issuer.entityId}->${subjectId}|${sortedScopes.join(',')}|exp:${expiresAtEpoch}`)
      .digest('hex');

    return {
      certId,
      issuerId: issuer.entityId,
      subjectId,
      issuerPublicKey: issuer.publicKey,
      subjectPublicKey,
      grantedScopes: sortedScopes,
      expiresAtEpoch,
      sigR,
      sigS,
      certDigest,
    };
  }

  public verifySingleCertificate(cert: DelegatedCertificate): boolean {
    const e = this.computeCertChallenge(
      cert.certId,
      cert.issuerId,
      cert.subjectId,
      cert.issuerPublicKey,
      cert.subjectPublicKey,
      cert.grantedScopes,
      cert.expiresAtEpoch,
      cert.sigR
    );
    const lhs = modPow(this.g, modNorm(cert.sigS, this.q), this.p);
    const rhs = (cert.sigR * modPow(cert.issuerPublicKey, e, this.p)) % this.p;
    return lhs === rhs;
  }

  public revokeCertificate(certId: string): void {
    this.revokedCertIds.add(certId);
  }

  public isRevoked(certId: string): boolean {
    return this.revokedCertIds.has(certId);
  }

  /**
   * Leaf holder creates a bound capability-invocation proof backed by the full delegation chain.
   */
  public createInvocationProof(
    invocationId: string,
    rootPublicKey: bigint,
    certificateChain: readonly DelegatedCertificate[],
    leafKey: ChainEntityKey,
    requestedScope: string,
    currentEpoch: number,
    challengeNonce: string
  ): DelegatedInvocationProof {
    if (certificateChain.length === 0) throw new Error('Delegation chain cannot be empty');
    const leafCert = certificateChain[certificateChain.length - 1];
    if (leafCert.subjectPublicKey !== leafKey.publicKey) {
      throw new Error('Leaf key does not match terminal certificate subjectPublicKey');
    }

    const k = randomScalar(this.q);
    const leafProofR = modPow(this.g, k, this.p);
    const e = hashScalar('WorkSphere::DelegInvoke', [
      invocationId,
      requestedScope,
      BigInt(currentEpoch),
      challengeNonce,
      leafKey.publicKey,
      leafCert.certDigest,
      leafProofR,
    ]);
    const leafProofS = modNorm(k + e * leafKey.secretKey, this.q);

    const invocationDigest = createHash('sha256')
      .update(`${invocationId}|scope:${requestedScope}|ep:${currentEpoch}|${leafCert.certDigest}`)
      .digest('hex');

    return {
      invocationId,
      requestedScope,
      currentEpoch,
      rootPublicKey,
      certificateChain: certificateChain.map((c) => ({ ...c, grantedScopes: [...c.grantedScopes] })),
      challengeNonce,
      leafProofR,
      leafProofS,
      invocationDigest,
    };
  }

  /**
   * Publicly audits a full multi-hop delegation chain + invocation proof:
   *   1. Verifies root anchor, unbroken key-to-key linkage, and every Schnorr cert signature.
   *   2. Verifies zero revoked certificates anywhere in the chain and non-expired epochs.
   *   3. Verifies STRICT capability attenuation at every hop (childScopes <= parentScopes).
   *   4. Verifies `requestedScope` is authorized by the terminal leaf cert + leaf holder Schnorr proof!
   */
  public verifyInvocationProof(
    proof: DelegatedInvocationProof,
    trustedRootPublicKey: bigint
  ): { valid: boolean; failedHopIndex?: number; reason?: string } {
    if (proof.certificateChain.length === 0) {
      return { valid: false, reason: 'Empty delegation chain' };
    }
    if (proof.rootPublicKey !== trustedRootPublicKey) {
      return { valid: false, reason: 'Root public key does not match trusted CA anchor' };
    }

    let expectedIssuerPub = trustedRootPublicKey;
    let allowedScopes: Set<string> | null = null;

    for (let i = 0; i < proof.certificateChain.length; i++) {
      const cert = proof.certificateChain[i];
      if (this.revokedCertIds.has(cert.certId)) {
        return { valid: false, failedHopIndex: i, reason: `Certificate ${cert.certId} is revoked` };
      }
      if (cert.expiresAtEpoch < proof.currentEpoch) {
        return { valid: false, failedHopIndex: i, reason: `Certificate ${cert.certId} expired` };
      }
      if (cert.issuerPublicKey !== expectedIssuerPub) {
        return { valid: false, failedHopIndex: i, reason: `Broken issuer key linkage at hop ${i}` };
      }
      if (!this.verifySingleCertificate(cert)) {
        return { valid: false, failedHopIndex: i, reason: `Invalid certificate signature at hop ${i}` };
      }

      // Enforce strict scope attenuation (no privilege escalation!)
      if (allowedScopes !== null) {
        for (const sc of cert.grantedScopes) {
          if (!allowedScopes.has(sc)) {
            return {
              valid: false,
              failedHopIndex: i,
              reason: `Privilege escalation blocked: scope '${sc}' not granted by parent`,
            };
          }
        }
      }

      allowedScopes = new Set(cert.grantedScopes);
      expectedIssuerPub = cert.subjectPublicKey;
    }

    if (!allowedScopes || !allowedScopes.has(proof.requestedScope)) {
      return { valid: false, reason: `Requested scope '${proof.requestedScope}' not granted to leaf` };
    }

    const leafCert = proof.certificateChain[proof.certificateChain.length - 1];
    const e = hashScalar('WorkSphere::DelegInvoke', [
      proof.invocationId,
      proof.requestedScope,
      BigInt(proof.currentEpoch),
      proof.challengeNonce,
      leafCert.subjectPublicKey,
      leafCert.certDigest,
      proof.leafProofR,
    ]);
    const lhs = modPow(this.g, modNorm(proof.leafProofS, this.q), this.p);
    const rhs = (proof.leafProofR * modPow(leafCert.subjectPublicKey, e, this.p)) % this.p;
    if (lhs !== rhs) {
      return { valid: false, reason: 'Leaf holder Schnorr possession proof failed' };
    }

    return { valid: true };
  }

  public serializeInvocation(proof: DelegatedInvocationProof): string {
    return JSON.stringify({
      ...proof,
      rootPublicKey: proof.rootPublicKey.toString(16),
      leafProofR: proof.leafProofR.toString(16),
      leafProofS: proof.leafProofS.toString(16),
      certificateChain: proof.certificateChain.map((c) => ({
        ...c,
        issuerPublicKey: c.issuerPublicKey.toString(16),
        subjectPublicKey: c.subjectPublicKey.toString(16),
        sigR: c.sigR.toString(16),
        sigS: c.sigS.toString(16),
      })),
    });
  }

  public deserializeInvocation(payload: string): DelegatedInvocationProof {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      ...raw,
      rootPublicKey: BigInt(`0x${raw.rootPublicKey}`),
      leafProofR: BigInt(`0x${raw.leafProofR}`),
      leafProofS: BigInt(`0x${raw.leafProofS}`),
      certificateChain: raw.certificateChain.map((c: Record<string, any>) => ({
        ...c,
        issuerPublicKey: BigInt(`0x${c.issuerPublicKey}`),
        subjectPublicKey: BigInt(`0x${c.subjectPublicKey}`),
        sigR: BigInt(`0x${c.sigR}`),
        sigS: BigInt(`0x${c.sigS}`),
      })),
    } as DelegatedInvocationProof;
  }
}
