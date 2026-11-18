/**
 * @file VerifiableCredentialSelectiveDisclosureBBS.ts
 * @description Multi-Attribute Pedersen Selective-Disclosure Verifiable Credential Issuer &
 * Zero-Knowledge Presentation Prover (BBS-Style Selective Disclosure + Scoped Pseudonyms).
 * Allows an organization issuer to sign a multi-attribute credential commitment
 * C = H_0^r * Prod_{i=0}^{L-1} H_{i+1}^{H_scalar(attr_i)} mod p using a Schnorr signature,
 * and allows the holder to present ANY subset of disclosed attributes while proving:
 *   1. The credential commitment carries a valid issuer signature.
 *   2. Knowledge of all undisclosed attributes + blinding scalar in zero knowledge.
 *   3. A deterministic scope-bound pseudonym P = H_scope^{holderMasterSecret} preventing cross-site tracking.
 */

import { createHash, randomBytes } from 'node:crypto';

const SUBGROUP_Q = 0x7fffffffffffffffffffffffffffe1d3n;
const SAFE_PRIME_P = 0xffffffffffffffffffffffffffffc3a7n;
const BASE_G = 4n;

export interface CredentialIssuerKey {
  issuerId: string;
  schemaId: string;
  attributeCount: number;
  secretKey: bigint;
  publicKey: bigint;
  blindingGenH0: bigint;
  attrGenerators: bigint[];
}

export interface IssuedCredential {
  credentialId: string;
  issuerId: string;
  schemaId: string;
  attributes: string[];
  attributeScalars: bigint[];
  blindingScalar: bigint;
  commitment: bigint;
  issuerSignatureR: bigint;
  issuerSignatureS: bigint;
}

export interface SelectiveDisclosurePresentation {
  presentationId: string;
  issuerId: string;
  schemaId: string;
  verifierNonce: string;
  scopeId: string;
  commitment: bigint;
  issuerSignatureR: bigint;
  issuerSignatureS: bigint;
  disclosedAttributes: Array<{ index: number; value: string }>;
  hiddenIndices: number[];
  scopedPseudonym: bigint;
  nonceCommit: bigint;
  pseudonymNonceCommit: bigint;
  challenge: bigint;
  hiddenResponses: bigint[];
  blindingResponse: bigint;
  presentationDigest: string;
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

function modInverse(a: bigint, m: bigint): bigint {
  let t = 0n;
  let newT = 1n;
  let r = m;
  let newR = modNorm(a, m);
  while (newR !== 0n) {
    const q = r / newR;
    [t, newT] = [newT, t - q * newT];
    [r, newR] = [newR, r - q * newR];
  }
  if (r > 1n) throw new Error('Not invertible');
  return t < 0n ? t + m : t;
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
 * Multi-Attribute Selective-Disclosure Credential Issuer & Zero-Knowledge Presentation Verifier.
 */
export class VerifiableCredentialSelectiveDisclosureBBS {
  private readonly p: bigint;
  private readonly q: bigint;
  private readonly g: bigint;

  constructor(p = SAFE_PRIME_P, q = SUBGROUP_Q, g = BASE_G) {
    if (p !== 2n * q + 1n) {
      throw new Error('Safe prime invariant p = 2q + 1 is required');
    }
    this.p = p;
    this.q = q;
    this.g = g;
  }

  private deriveGenerator(tag: string): bigint {
    for (let ctr = 0; ctr < 1024; ctr++) {
      const hex = createHash('sha256').update(`WorkSphere::BBSCredGen|${tag}|${ctr}`).digest('hex');
      const raw = BigInt(`0x${hex}`) % (this.p - 2n) + 2n;
      const cand = (raw * raw) % this.p;
      if (cand > 1n && modPow(cand, this.q, this.p) === 1n) {
        return cand;
      }
    }
    throw new Error(`Failed to derive generator ${tag}`);
  }

  public mapAttributeToScalar(schemaId: string, index: number, value: string): bigint {
    return hashScalar('WorkSphere::BBSAttr', [schemaId, BigInt(index), value]);
  }

  public setupIssuer(issuerId: string, schemaId: string, attributeCount: number): CredentialIssuerKey {
    if (!Number.isInteger(attributeCount) || attributeCount < 2) {
      throw new RangeError('Credential schema requires at least 2 attributes (index 0 = holder secret)');
    }
    const secretKey = randomScalar(this.q);
    const publicKey = modPow(this.g, secretKey, this.p);
    const blindingGenH0 = this.deriveGenerator(`${issuerId}:${schemaId}:H0`);
    const attrGenerators: bigint[] = [];
    for (let i = 0; i < attributeCount; i++) {
      attrGenerators.push(this.deriveGenerator(`${issuerId}:${schemaId}:Attr:${i}`));
    }
    return {
      issuerId,
      schemaId,
      attributeCount,
      secretKey,
      publicKey,
      blindingGenH0,
      attrGenerators,
    };
  }

  private computeIssuerChallenge(
    issuerKey: Pick<CredentialIssuerKey, 'issuerId' | 'schemaId' | 'publicKey'>,
    commitment: bigint,
    R: bigint
  ): bigint {
    return hashScalar('WorkSphere::BBSIssuerSig', [
      issuerKey.issuerId,
      issuerKey.schemaId,
      issuerKey.publicKey,
      commitment,
      R,
    ]);
  }

  /**
   * Issues a signed multi-attribute Pedersen credential. Attribute index 0 serves as the holder's
   * private identity secret used for deriving unlinkable verifier-scoped pseudonyms.
   */
  public issueCredential(
    issuer: CredentialIssuerKey,
    credentialId: string,
    attributes: readonly string[]
  ): IssuedCredential {
    if (attributes.length !== issuer.attributeCount) {
      throw new Error(`Expected ${issuer.attributeCount} attributes, got ${attributes.length}`);
    }

    const attributeScalars = attributes.map((val, idx) =>
      this.mapAttributeToScalar(issuer.schemaId, idx, val)
    );
    const blindingScalar = randomScalar(this.q);

    let commitment = modPow(issuer.blindingGenH0, blindingScalar, this.p);
    for (let i = 0; i < attributeScalars.length; i++) {
      commitment = (commitment * modPow(issuer.attrGenerators[i], attributeScalars[i], this.p)) % this.p;
    }

    const k = randomScalar(this.q);
    const issuerSignatureR = modPow(this.g, k, this.p);
    const e = this.computeIssuerChallenge(issuer, commitment, issuerSignatureR);
    const issuerSignatureS = modNorm(k + e * issuer.secretKey, this.q);

    return {
      credentialId,
      issuerId: issuer.issuerId,
      schemaId: issuer.schemaId,
      attributes: [...attributes],
      attributeScalars,
      blindingScalar,
      commitment,
      issuerSignatureR,
      issuerSignatureS,
    };
  }

  public verifyIssuerSignature(
    issuer: Pick<CredentialIssuerKey, 'issuerId' | 'schemaId' | 'publicKey'>,
    commitment: bigint,
    R: bigint,
    s: bigint
  ): boolean {
    const e = this.computeIssuerChallenge(issuer, commitment, R);
    const lhs = modPow(this.g, modNorm(s, this.q), this.p);
    const rhs = (R * modPow(issuer.publicKey, e, this.p)) % this.p;
    return lhs === rhs;
  }

  /**
   * Holder creates a zero-knowledge selective-disclosure presentation disclosing ONLY
   * `disclosedIndices` (index 0 holder secret MUST remain hidden!) along with a scope-bound pseudonym.
   */
  public createPresentation(
    presentationId: string,
    issuerPublic: Omit<CredentialIssuerKey, 'secretKey'>,
    credential: IssuedCredential,
    disclosedIndices: readonly number[],
    scopeId: string,
    verifierNonce: string
  ): SelectiveDisclosurePresentation {
    const disclosedSet = new Set<number>();
    for (const idx of disclosedIndices) {
      if (!Number.isInteger(idx) || idx < 1 || idx >= issuerPublic.attributeCount) {
        throw new RangeError(`Disclosed attribute index ${idx} must be in [1, ${issuerPublic.attributeCount - 1}]`);
      }
      disclosedSet.add(idx);
    }

    const sortedDisclosed = Array.from(disclosedSet).sort((a, b) => a - b);
    const disclosedAttributes = sortedDisclosed.map((index) => ({
      index,
      value: credential.attributes[index],
    }));

    // Index 0 is ALWAYS first in hiddenIndices so it links cleanly to scopedPseudonym
    const hiddenIndices: number[] = [0];
    for (let i = 1; i < issuerPublic.attributeCount; i++) {
      if (!disclosedSet.has(i)) hiddenIndices.push(i);
    }

    const scopeGen = this.deriveGenerator(`scope:${issuerPublic.schemaId}:${scopeId}`);
    const holderSecret = credential.attributeScalars[0];
    const scopedPseudonym = modPow(scopeGen, holderSecret, this.p);

    const kR = randomScalar(this.q);
    const kHidden = hiddenIndices.map(() => randomScalar(this.q));

    let nonceCommit = modPow(issuerPublic.blindingGenH0, kR, this.p);
    for (let m = 0; m < hiddenIndices.length; m++) {
      nonceCommit =
        (nonceCommit * modPow(issuerPublic.attrGenerators[hiddenIndices[m]], kHidden[m], this.p)) % this.p;
    }
    const pseudonymNonceCommit = modPow(scopeGen, kHidden[0], this.p);

    const challenge = hashScalar('WorkSphere::BBSPresentation', [
      presentationId,
      issuerPublic.issuerId,
      issuerPublic.schemaId,
      verifierNonce,
      scopeId,
      credential.commitment,
      scopedPseudonym,
      nonceCommit,
      pseudonymNonceCommit,
      ...disclosedAttributes.flatMap((d) => [BigInt(d.index), d.value]),
    ]);

    const hiddenResponses = hiddenIndices.map((attrIdx, m) =>
      modNorm(kHidden[m] + challenge * credential.attributeScalars[attrIdx], this.q)
    );
    const blindingResponse = modNorm(kR + challenge * credential.blindingScalar, this.q);

    const presentationDigest = createHash('sha256')
      .update(`${presentationId}|${scopeId}|${scopedPseudonym.toString(16)}|${challenge.toString(16)}`)
      .digest('hex');

    return {
      presentationId,
      issuerId: credential.issuerId,
      schemaId: credential.schemaId,
      verifierNonce,
      scopeId,
      commitment: credential.commitment,
      issuerSignatureR: credential.issuerSignatureR,
      issuerSignatureS: credential.issuerSignatureS,
      disclosedAttributes,
      hiddenIndices,
      scopedPseudonym,
      nonceCommit,
      pseudonymNonceCommit,
      challenge,
      hiddenResponses,
      blindingResponse,
      presentationDigest,
    };
  }

  /**
   * Publicly verifies a selective-disclosure presentation (issuer signature + hidden-attribute ZK proof
   * + scope-bound pseudonym linkage) without learning any undisclosed attribute!
   */
  public verifyPresentation(
    issuerPublic: Omit<CredentialIssuerKey, 'secretKey'>,
    presentation: SelectiveDisclosurePresentation,
    expectedNonce: string,
    expectedScopeId: string
  ): { valid: boolean; reason?: string } {
    if (presentation.verifierNonce !== expectedNonce || presentation.scopeId !== expectedScopeId) {
      return { valid: false, reason: 'Verifier nonce or scopeId mismatch' };
    }
    if (
      !this.verifyIssuerSignature(
        issuerPublic,
        presentation.commitment,
        presentation.issuerSignatureR,
        presentation.issuerSignatureS
      )
    ) {
      return { valid: false, reason: 'Issuer signature on credential commitment is invalid' };
    }

    if (presentation.hiddenIndices[0] !== 0) {
      return { valid: false, reason: 'Holder secret attribute 0 must remain hidden and bound to pseudonym' };
    }
    if (presentation.hiddenIndices.length !== presentation.hiddenResponses.length) {
      return { valid: false, reason: 'Hidden index/response count mismatch' };
    }

    const seen = new Set<number>();
    let disclosedProd = 1n;
    for (const d of presentation.disclosedAttributes) {
      if (d.index < 1 || d.index >= issuerPublic.attributeCount || seen.has(d.index)) {
        return { valid: false, reason: `Invalid disclosed index ${d.index}` };
      }
      seen.add(d.index);
      const scalar = this.mapAttributeToScalar(issuerPublic.schemaId, d.index, d.value);
      disclosedProd = (disclosedProd * modPow(issuerPublic.attrGenerators[d.index], scalar, this.p)) % this.p;
    }

    for (const hIdx of presentation.hiddenIndices) {
      if (hIdx < 0 || hIdx >= issuerPublic.attributeCount || seen.has(hIdx)) {
        return { valid: false, reason: `Invalid or overlapping hidden index ${hIdx}` };
      }
      seen.add(hIdx);
    }
    if (seen.size !== issuerPublic.attributeCount) {
      return { valid: false, reason: 'Attribute indices do not partition schema' };
    }

    const expectedC = hashScalar('WorkSphere::BBSPresentation', [
      presentation.presentationId,
      issuerPublic.issuerId,
      issuerPublic.schemaId,
      presentation.verifierNonce,
      presentation.scopeId,
      presentation.commitment,
      presentation.scopedPseudonym,
      presentation.nonceCommit,
      presentation.pseudonymNonceCommit,
      ...presentation.disclosedAttributes.flatMap((d) => [BigInt(d.index), d.value]),
    ]);
    if (expectedC !== presentation.challenge) {
      return { valid: false, reason: 'Presentation Fiat-Shamir challenge mismatch' };
    }

    // Verify Pedersen residual opening
    const residual = (presentation.commitment * modInverse(disclosedProd, this.p)) % this.p;
    let lhsCred = modPow(issuerPublic.blindingGenH0, modNorm(presentation.blindingResponse, this.q), this.p);
    for (let m = 0; m < presentation.hiddenIndices.length; m++) {
      lhsCred =
        (lhsCred *
          modPow(
            issuerPublic.attrGenerators[presentation.hiddenIndices[m]],
            modNorm(presentation.hiddenResponses[m], this.q),
            this.p
          )) %
        this.p;
    }
    const rhsCred = (presentation.nonceCommit * modPow(residual, presentation.challenge, this.p)) % this.p;
    if (lhsCred !== rhsCred) {
      return { valid: false, reason: 'Zero-knowledge credential attribute proof failed' };
    }

    // Verify scoped pseudonym linkage: scopeGen^{z_0} == pseudoNonce * pseudonym^e mod p
    const scopeGen = this.deriveGenerator(`scope:${issuerPublic.schemaId}:${presentation.scopeId}`);
    const lhsP = modPow(scopeGen, modNorm(presentation.hiddenResponses[0], this.q), this.p);
    const rhsP =
      (presentation.pseudonymNonceCommit * modPow(presentation.scopedPseudonym, presentation.challenge, this.p)) %
      this.p;
    if (lhsP !== rhsP) {
      return { valid: false, reason: 'Scoped pseudonym linkage proof failed' };
    }

    return { valid: true };
  }

  public serializePresentation(pres: SelectiveDisclosurePresentation): string {
    return JSON.stringify({
      ...pres,
      commitment: pres.commitment.toString(16),
      issuerSignatureR: pres.issuerSignatureR.toString(16),
      issuerSignatureS: pres.issuerSignatureS.toString(16),
      scopedPseudonym: pres.scopedPseudonym.toString(16),
      nonceCommit: pres.nonceCommit.toString(16),
      pseudonymNonceCommit: pres.pseudonymNonceCommit.toString(16),
      challenge: pres.challenge.toString(16),
      hiddenResponses: pres.hiddenResponses.map((r) => r.toString(16)),
      blindingResponse: pres.blindingResponse.toString(16),
    });
  }

  public deserializePresentation(payload: string): SelectiveDisclosurePresentation {
    const raw = JSON.parse(payload) as Record<string, any>;
    return {
      ...raw,
      commitment: BigInt(`0x${raw.commitment}`),
      issuerSignatureR: BigInt(`0x${raw.issuerSignatureR}`),
      issuerSignatureS: BigInt(`0x${raw.issuerSignatureS}`),
      scopedPseudonym: BigInt(`0x${raw.scopedPseudonym}`),
      nonceCommit: BigInt(`0x${raw.nonceCommit}`),
      pseudonymNonceCommit: BigInt(`0x${raw.pseudonymNonceCommit}`),
      challenge: BigInt(`0x${raw.challenge}`),
      hiddenResponses: raw.hiddenResponses.map((r: string) => BigInt(`0x${r}`)),
      blindingResponse: BigInt(`0x${raw.blindingResponse}`),
    } as SelectiveDisclosurePresentation;
  }
}
