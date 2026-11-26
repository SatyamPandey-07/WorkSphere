import { createHash, randomBytes } from 'node:crypto';

/**
 * Verifiable Multi-Hop Capability Delegation Chain Prover (UCAN / Macaroon-style).
 *
 * Implements cryptographically verifiable multi-hop authority delegation across principals:
 *  - Root authority signs a delegation token granting scopes S_0, maxSpend B_0, expiry T_0
 *    to delegatee D_1.
 *  - Any delegatee D_k may re-delegate to D_{k+1} ONLY with strictly attenuated privileges:
 *      - scopes S_{k+1} subset-of S_k  (no scope escalation!)
 *      - maxSpend B_{k+1} <= B_k       (no budget escalation!)
 *      - expiresAt T_{k+1} <= T_k      (no lifetime extension!)
 *      - maxDepthRemaining decrements by >= 1 (bounded delegation depth!)
 *  - Verifier checks every Schnorr signature link from root to leaf, verifies monotonic
 *    attenuation at every hop, checks active revocation list, and verifies requested action!
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

export interface PrincipalIdentity {
  id: string;
  secretKey: bigint;
  publicKey: bigint;
}

export interface DelegationLink {
  tokenId: string;
  parentTokenId: string | null;
  issuerId: string;
  issuerPubKey: bigint;
  subjectId: string;
  subjectPubKey: bigint;
  allowedScopes: string[];
  maxSpendLimit: bigint;
  expiresAtMs: number;
  remainingHops: number;
  linkDigest: string;
  sigR: bigint;
  sigS: bigint;
}

export interface InvocationRequest {
  scope: string;
  spendAmount: bigint;
  timestampMs: number;
  invokerSigR: bigint;
  invokerSigS: bigint;
}

export interface DelegationAuditResult {
  authorized: boolean;
  hopCount: number;
  rootIssuerId: string;
  leafSubjectId: string;
  reason?: string;
}

export class VerifiableMultiHopDelegationProver {
  private revokedTokenIds = new Set<string>();

  public createPrincipal(id: string): PrincipalIdentity {
    const secretKey = randomScalar();
    return { id, secretKey, publicKey: modPow(BASE_G, secretKey, SAFE_PRIME_P) };
  }

  public revokeToken(tokenId: string): void {
    this.revokedTokenIds.add(tokenId);
  }

  public isRevoked(tokenId: string): boolean {
    return this.revokedTokenIds.has(tokenId);
  }

  private signDigest(principal: PrincipalIdentity, domain: string, digest: string): { sigR: bigint; sigS: bigint } {
    const k = randomScalar();
    const sigR = modPow(BASE_G, k, SAFE_PRIME_P);
    const c = hashToScalar(domain, sigR.toString(16), principal.publicKey.toString(16), digest);
    return { sigR, sigS: modScalar(k + c * principal.secretKey) };
  }

  private verifySig(pubKey: bigint, domain: string, digest: string, sigR: bigint, sigS: bigint): boolean {
    const c = hashToScalar(domain, sigR.toString(16), pubKey.toString(16), digest);
    return modPow(BASE_G, sigS, SAFE_PRIME_P) === (sigR * modPow(pubKey, c, SAFE_PRIME_P)) % SAFE_PRIME_P;
  }

  public computeLinkDigest(link: Omit<DelegationLink, 'linkDigest' | 'sigR' | 'sigS'>): string {
    const sortedScopes = [...new Set(link.allowedScopes)].sort();
    return sha256Hex(
      'DELEG-LINK-V1',
      link.tokenId,
      link.parentTokenId ?? 'ROOT',
      link.issuerId,
      link.issuerPubKey.toString(16),
      link.subjectId,
      link.subjectPubKey.toString(16),
      sortedScopes.join(','),
      link.maxSpendLimit.toString(),
      String(link.expiresAtMs),
      String(link.remainingHops),
    );
  }

  public issueRootGrant(params: {
    tokenId: string;
    rootIssuer: PrincipalIdentity;
    subject: Pick<PrincipalIdentity, 'id' | 'publicKey'>;
    allowedScopes: string[];
    maxSpendLimit: bigint;
    expiresAtMs: number;
    maxHops: number;
  }): DelegationLink {
    if (params.allowedScopes.length === 0 || params.maxSpendLimit < 0n || params.maxHops < 0) {
      throw new RangeError('Invalid root delegation parameters');
    }
    const base: Omit<DelegationLink, 'linkDigest' | 'sigR' | 'sigS'> = {
      tokenId: params.tokenId,
      parentTokenId: null,
      issuerId: params.rootIssuer.id,
      issuerPubKey: params.rootIssuer.publicKey,
      subjectId: params.subject.id,
      subjectPubKey: params.subject.publicKey,
      allowedScopes: [...new Set(params.allowedScopes)].sort(),
      maxSpendLimit: params.maxSpendLimit,
      expiresAtMs: params.expiresAtMs,
      remainingHops: params.maxHops,
    };
    const linkDigest = this.computeLinkDigest(base);
    const { sigR, sigS } = this.signDigest(params.rootIssuer, 'DELEG-SIG-V1', linkDigest);
    return { ...base, linkDigest, sigR, sigS };
  }

  public delegateFurther(params: {
    tokenId: string;
    parentLink: DelegationLink;
    delegator: PrincipalIdentity;
    nextSubject: Pick<PrincipalIdentity, 'id' | 'publicKey'>;
    attenuatedScopes: string[];
    maxSpendLimit: bigint;
    expiresAtMs: number;
  }): DelegationLink {
    const p = params.parentLink;
    if (p.subjectId !== params.delegator.id || p.subjectPubKey !== params.delegator.publicKey) {
      throw new Error('Delegator identity does not match parent token subject');
    }
    if (p.remainingHops < 1) {
      throw new Error('Parent delegation link has zero remaining re-delegation hops');
    }
    const parentScopeSet = new Set(p.allowedScopes);
    const childScopes = [...new Set(params.attenuatedScopes)].sort();
    if (childScopes.length === 0 || childScopes.some((s) => !parentScopeSet.has(s))) {
      throw new Error('Scope escalation rejected: child scopes must be a non-empty subset of parent scopes');
    }
    if (params.maxSpendLimit < 0n || params.maxSpendLimit > p.maxSpendLimit) {
      throw new Error('Budget escalation rejected: child maxSpendLimit exceeds parent limit');
    }
    if (params.expiresAtMs > p.expiresAtMs) {
      throw new Error('Lifetime escalation rejected: child expiry exceeds parent expiry');
    }

    const base: Omit<DelegationLink, 'linkDigest' | 'sigR' | 'sigS'> = {
      tokenId: params.tokenId,
      parentTokenId: p.tokenId,
      issuerId: params.delegator.id,
      issuerPubKey: params.delegator.publicKey,
      subjectId: params.nextSubject.id,
      subjectPubKey: params.nextSubject.publicKey,
      allowedScopes: childScopes,
      maxSpendLimit: params.maxSpendLimit,
      expiresAtMs: params.expiresAtMs,
      remainingHops: p.remainingHops - 1,
    };
    const linkDigest = this.computeLinkDigest(base);
    const { sigR, sigS } = this.signDigest(params.delegator, 'DELEG-SIG-V1', linkDigest);
    return { ...base, linkDigest, sigR, sigS };
  }

  public signInvocation(
    leafPrincipal: PrincipalIdentity,
    leafTokenId: string,
    scope: string,
    spendAmount: bigint,
    timestampMs: number,
  ): InvocationRequest {
    const digest = sha256Hex('DELEG-INVOKE-V1', leafTokenId, scope, spendAmount.toString(), String(timestampMs));
    const { sigR: invokerSigR, sigS: invokerSigS } = this.signDigest(leafPrincipal, 'DELEG-INVOKE-SIG', digest);
    return { scope, spendAmount, timestampMs, invokerSigR, invokerSigS };
  }

  public verifyDelegationChain(
    trustedRootPubKey: bigint,
    chain: DelegationLink[],
    invocation: InvocationRequest,
  ): DelegationAuditResult {
    if (chain.length === 0) {
      return { authorized: false, hopCount: 0, rootIssuerId: '', leafSubjectId: '', reason: 'Empty delegation chain' };
    }

    const root = chain[0];
    const leaf = chain[chain.length - 1];
    if (root.parentTokenId !== null || root.issuerPubKey !== trustedRootPubKey) {
      return {
        authorized: false,
        hopCount: chain.length,
        rootIssuerId: root.issuerId,
        leafSubjectId: leaf.subjectId,
        reason: 'Root link does not anchor to trusted root public key',
      };
    }

    const seenTokens = new Set<string>();
    for (let i = 0; i < chain.length; i++) {
      const link = chain[i];
      if (seenTokens.has(link.tokenId)) {
        return { authorized: false, hopCount: chain.length, rootIssuerId: root.issuerId, leafSubjectId: leaf.subjectId, reason: 'Cycle detected in delegation chain' };
      }
      seenTokens.add(link.tokenId);

      if (this.revokedTokenIds.has(link.tokenId)) {
        return { authorized: false, hopCount: chain.length, rootIssuerId: root.issuerId, leafSubjectId: leaf.subjectId, reason: `Token "${link.tokenId}" has been revoked` };
      }
      if (this.computeLinkDigest(link) !== link.linkDigest) {
        return { authorized: false, hopCount: chain.length, rootIssuerId: root.issuerId, leafSubjectId: leaf.subjectId, reason: `Link digest mismatch at hop ${i}` };
      }
      if (!this.verifySig(link.issuerPubKey, 'DELEG-SIG-V1', link.linkDigest, link.sigR, link.sigS)) {
        return { authorized: false, hopCount: chain.length, rootIssuerId: root.issuerId, leafSubjectId: leaf.subjectId, reason: `Invalid issuer signature at hop ${i}` };
      }
      if (invocation.timestampMs > link.expiresAtMs) {
        return { authorized: false, hopCount: chain.length, rootIssuerId: root.issuerId, leafSubjectId: leaf.subjectId, reason: `Token "${link.tokenId}" expired` };
      }

      if (i > 0) {
        const prev = chain[i - 1];
        if (link.parentTokenId !== prev.tokenId || link.issuerId !== prev.subjectId || link.issuerPubKey !== prev.subjectPubKey) {
          return { authorized: false, hopCount: chain.length, rootIssuerId: root.issuerId, leafSubjectId: leaf.subjectId, reason: `Broken principal link at hop ${i}` };
        }
        if (link.remainingHops > prev.remainingHops - 1 || link.remainingHops < 0) {
          return { authorized: false, hopCount: chain.length, rootIssuerId: root.issuerId, leafSubjectId: leaf.subjectId, reason: `Hop limit violation at hop ${i}` };
        }
        const prevScopes = new Set(prev.allowedScopes);
        if (link.allowedScopes.some((s) => !prevScopes.has(s))) {
          return { authorized: false, hopCount: chain.length, rootIssuerId: root.issuerId, leafSubjectId: leaf.subjectId, reason: `Scope escalation detected at hop ${i}` };
        }
        if (link.maxSpendLimit > prev.maxSpendLimit || link.expiresAtMs > prev.expiresAtMs) {
          return { authorized: false, hopCount: chain.length, rootIssuerId: root.issuerId, leafSubjectId: leaf.subjectId, reason: `Limit or expiry escalation at hop ${i}` };
        }
      }
    }

    if (!leaf.allowedScopes.includes(invocation.scope)) {
      return { authorized: false, hopCount: chain.length, rootIssuerId: root.issuerId, leafSubjectId: leaf.subjectId, reason: `Scope "${invocation.scope}" not permitted by leaf token` };
    }
    if (invocation.spendAmount < 0n || invocation.spendAmount > leaf.maxSpendLimit) {
      return { authorized: false, hopCount: chain.length, rootIssuerId: root.issuerId, leafSubjectId: leaf.subjectId, reason: 'Spend amount exceeds delegated limit' };
    }

    const invDigest = sha256Hex('DELEG-INVOKE-V1', leaf.tokenId, invocation.scope, invocation.spendAmount.toString(), String(invocation.timestampMs));
    if (!this.verifySig(leaf.subjectPubKey, 'DELEG-INVOKE-SIG', invDigest, invocation.invokerSigR, invocation.invokerSigS)) {
      return { authorized: false, hopCount: chain.length, rootIssuerId: root.issuerId, leafSubjectId: leaf.subjectId, reason: 'Invalid leaf invoker signature' };
    }

    return { authorized: true, hopCount: chain.length, rootIssuerId: root.issuerId, leafSubjectId: leaf.subjectId };
  }

  public serializeChain(chain: DelegationLink[]): string {
    return JSON.stringify({
      hopCount: chain.length,
      tokenIds: chain.map((l) => l.tokenId),
      leafScopes: chain.length > 0 ? chain[chain.length - 1].allowedScopes : [],
    });
  }
}
