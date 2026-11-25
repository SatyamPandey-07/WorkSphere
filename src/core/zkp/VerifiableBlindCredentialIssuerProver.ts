import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Blind Credential Issuer & Pseudonym Presentation Prover.
 *
 * Implements an unlinkable Schnorr Blind Signature Credential protocol with domain-scoped
 * verifiable pseudonyms:
 *  1. Issuer holds keypair (sk_I, pk_I = g^{sk_I}) and commits nonce R = g^k.
 *  2. User selects secret identity scalar u, binds credential payload M = H(g^u || attributes),
 *     blinds R' = R * g^alpha * pk_I^beta, computes challenge c' = H(R', pk_I, M),
 *     and sends blinded challenge c = (c' + beta) mod Q to issuer.
 *  3. Issuer returns blind signature s = (k + c * sk_I) mod Q without ever seeing M or R'!
 *  4. User unblinds s' = (s + alpha) mod Q:
 *       g^{s'} = g^s * g^alpha = (R * pk_I^{c' + beta}) * g^alpha = (R * g^alpha * pk_I^beta) * pk_I^{c'} = R' * pk_I^{c'}!
 *  5. When presenting to any verifier domain D, user reveals (R', s', pk_U = g^u) plus a
 *     Chaum-Pedersen DLEQ proof of domain pseudonym P_D = HashToSubgroup(D)^u so the verifier
 *     can enforce 1-credential-per-domain anti-sybil limits without linking across domains!
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

export interface IssuerKeyPair {
  issuerId: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface IssuanceSession {
  sessionId: string;
  nonceK: bigint;
  commitmentR: bigint;
}

export interface BlindRequestState {
  credentialPayload: string;
  userSecretU: bigint;
  userPubKey: bigint;
  alpha: bigint;
  beta: bigint;
  blindedR: bigint;
  unblindedChallenge: bigint;
  blindedChallengeToIssuer: bigint;
}

export interface UnlinkableCredential {
  issuerId: string;
  issuerPublicKey: bigint;
  userPubKey: bigint;
  attributesDigest: string;
  credentialPayload: string;
  sigR: bigint;
  sigS: bigint;
}

export interface DomainPresentationProof {
  credential: UnlinkableCredential;
  verifierDomain: string;
  pseudonym: bigint; // H_D^u
  dleqA: bigint;
  dleqB: bigint;
  challenge: bigint;
  responseU: bigint;
}

export class VerifiableBlindCredentialIssuerProver {
  private domainPseudonymRegistry = new Map<string, Set<string>>();

  public createIssuer(issuerId: string): IssuerKeyPair {
    const secretKey = randomScalar();
    return { issuerId, secretKey, publicKey: modPow(BASE_G, secretKey, SAFE_PRIME_P) };
  }

  public startIssuanceSession(sessionId: string): IssuanceSession {
    const nonceK = randomScalar();
    return { sessionId, nonceK, commitmentR: modPow(BASE_G, nonceK, SAFE_PRIME_P) };
  }

  public hashToSubgroup(domain: string): bigint {
    const hex = sha256Hex('CRED-DOMAIN-H2G-V1', domain);
    const raw = (BigInt('0x' + hex.slice(0, 32)) % (SAFE_PRIME_P - 3n)) + 2n;
    const qr = (raw * raw) % SAFE_PRIME_P;
    return qr === 1n ? BASE_G : qr;
  }

  public prepareBlindRequest(
    issuerPublicKey: bigint,
    issuerCommitmentR: bigint,
    attributes: Record<string, string>,
    userSecret?: bigint,
  ): BlindRequestState {
    const userSecretU = userSecret !== undefined ? modScalar(userSecret) : randomScalar();
    const userPubKey = modPow(BASE_G, userSecretU, SAFE_PRIME_P);
    const canonicalAttrs = Object.keys(attributes)
      .sort()
      .map((k) => `${k}=${attributes[k]}`)
      .join('&');
    const attributesDigest = sha256Hex('CRED-ATTRS-V1', canonicalAttrs);
    const credentialPayload = sha256Hex('CRED-PAYLOAD-V1', userPubKey.toString(16), attributesDigest);

    const alpha = randomScalar();
    const beta = randomScalar();

    // R' = R * g^alpha * pk_I^beta mod P
    const blindedR = (
      ((issuerCommitmentR * modPow(BASE_G, alpha, SAFE_PRIME_P)) % SAFE_PRIME_P) *
      modPow(issuerPublicKey, beta, SAFE_PRIME_P)
    ) % SAFE_PRIME_P;

    const unblindedChallenge = hashToScalar(
      'BLIND-CRED-SCHNORR-V1',
      blindedR.toString(16),
      issuerPublicKey.toString(16),
      credentialPayload,
    );
    const blindedChallengeToIssuer = modScalar(unblindedChallenge + beta);

    return {
      credentialPayload,
      userSecretU,
      userPubKey,
      alpha,
      beta,
      blindedR,
      unblindedChallenge,
      blindedChallengeToIssuer,
    };
  }

  public issuerBlindSign(issuer: IssuerKeyPair, session: IssuanceSession, blindedChallenge: bigint): bigint {
    return modScalar(session.nonceK + modScalar(blindedChallenge) * issuer.secretKey);
  }

  public unblindCredential(
    issuer: Pick<IssuerKeyPair, 'issuerId' | 'publicKey'>,
    req: BlindRequestState,
    blindSigS: bigint,
    attributes: Record<string, string>,
  ): UnlinkableCredential {
    const sigS = modScalar(blindSigS + req.alpha);
    const canonicalAttrs = Object.keys(attributes)
      .sort()
      .map((k) => `${k}=${attributes[k]}`)
      .join('&');
    const attributesDigest = sha256Hex('CRED-ATTRS-V1', canonicalAttrs);

    const cred: UnlinkableCredential = {
      issuerId: issuer.issuerId,
      issuerPublicKey: issuer.publicKey,
      userPubKey: req.userPubKey,
      attributesDigest,
      credentialPayload: req.credentialPayload,
      sigR: req.blindedR,
      sigS,
    };
    if (!this.verifyCredentialSignature(cred)) {
      throw new Error('Unblinded credential failed issuer signature verification');
    }
    return cred;
  }

  public verifyCredentialSignature(cred: UnlinkableCredential): boolean {
    const expectedPayload = sha256Hex('CRED-PAYLOAD-V1', cred.userPubKey.toString(16), cred.attributesDigest);
    if (expectedPayload !== cred.credentialPayload) return false;
    const c = hashToScalar(
      'BLIND-CRED-SCHNORR-V1',
      cred.sigR.toString(16),
      cred.issuerPublicKey.toString(16),
      cred.credentialPayload,
    );
    const lhs = modPow(BASE_G, cred.sigS, SAFE_PRIME_P);
    const rhs = (cred.sigR * modPow(cred.issuerPublicKey, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return lhs === rhs;
  }

  public createDomainPresentation(
    cred: UnlinkableCredential,
    userSecretU: bigint,
    verifierDomain: string,
  ): DomainPresentationProof {
    const H = this.hashToSubgroup(verifierDomain);
    const pseudonym = modPow(H, userSecretU, SAFE_PRIME_P);
    const k = randomScalar();
    const dleqA = modPow(BASE_G, k, SAFE_PRIME_P);
    const dleqB = modPow(H, k, SAFE_PRIME_P);
    const challenge = hashToScalar(
      'CRED-PSEUDONYM-DLEQ-V1',
      verifierDomain,
      cred.credentialPayload,
      cred.userPubKey.toString(16),
      pseudonym.toString(16),
      dleqA.toString(16),
      dleqB.toString(16),
    );
    const responseU = modScalar(k + challenge * userSecretU);
    return {
      credential: cred,
      verifierDomain,
      pseudonym,
      dleqA,
      dleqB,
      challenge,
      responseU,
    };
  }

  public verifyDomainPresentation(proof: DomainPresentationProof): boolean {
    if (!this.verifyCredentialSignature(proof.credential)) return false;
    const H = this.hashToSubgroup(proof.verifierDomain);
    const expectedC = hashToScalar(
      'CRED-PSEUDONYM-DLEQ-V1',
      proof.verifierDomain,
      proof.credential.credentialPayload,
      proof.credential.userPubKey.toString(16),
      proof.pseudonym.toString(16),
      proof.dleqA.toString(16),
      proof.dleqB.toString(16),
    );
    if (expectedC !== proof.challenge) return false;
    const eq1 = modPow(BASE_G, proof.responseU, SAFE_PRIME_P) ===
      (proof.dleqA * modPow(proof.credential.userPubKey, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    const eq2 = modPow(H, proof.responseU, SAFE_PRIME_P) ===
      (proof.dleqB * modPow(proof.pseudonym, proof.challenge, SAFE_PRIME_P)) % SAFE_PRIME_P;
    return eq1 && eq2;
  }

  public admitOncePerDomain(proof: DomainPresentationProof): { admitted: boolean; duplicatePseudonym: boolean } {
    if (!this.verifyDomainPresentation(proof)) return { admitted: false, duplicatePseudonym: false };
    let set = this.domainPseudonymRegistry.get(proof.verifierDomain);
    if (!set) {
      set = new Set<string>();
      this.domainPseudonymRegistry.set(proof.verifierDomain, set);
    }
    const tag = proof.pseudonym.toString(16);
    if (set.has(tag)) return { admitted: false, duplicatePseudonym: true };
    set.add(tag);
    return { admitted: true, duplicatePseudonym: false };
  }

  public serializePresentation(proof: DomainPresentationProof): string {
    return JSON.stringify({
      issuerId: proof.credential.issuerId,
      verifierDomain: proof.verifierDomain,
      pseudonym: proof.pseudonym.toString(16),
    });
  }
}
