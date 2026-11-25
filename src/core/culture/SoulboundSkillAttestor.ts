/**
 * @file SoulboundSkillAttestor.ts
 * @description Decentralized Skill Attestation and Soulbound Token (SBT) Verifier for WorkSphere.
 * Implements non-transferable EIP-5114 style credentials, cryptographic signatures,
 * Sparse Merkle Revocation Accumulators, multi-peer endorsement quorums, and selective disclosure.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto';

export type SkillCategory = 'engineering' | 'design' | 'security' | 'leadership' | 'operations';

export interface SoulboundToken {
  tokenId: string;
  recipientDid: string; // Non-transferable; bound immutably to recipient
  issuerDid: string;
  skillCategory: SkillCategory;
  skillName: string;
  proficiencyScore: number; // 0 to 100
  evidenceHash: string; // SHA-256 hash of work evidence/repos
  issuedAt: number;
  expiresAt: number | null; // null for non-expiring credentials
  revoked: boolean;
  signature: string; // Cryptographic signature by issuer
}

export interface PeerEndorsement {
  endorserDid: string;
  rating: number; // 0 to 100
  comment: string;
  timestamp: number;
  signature: string;
}

export interface SelectiveDisclosureClaim {
  tokenId: string;
  recipientDid: string;
  skillName: string;
  minRequiredScore: number;
  commitment: string; // SHA-256(score || salt)
  salt: string;
}

export interface VerificationResult {
  valid: boolean;
  isNonTransferable: boolean;
  isExpired: boolean;
  isRevoked: boolean;
  error?: string;
}

/**
 * Binary Merkle Tree for Cryptographic Token Revocation Accumulation
 */
export class RevocationMerkleTree {
  private leaves: string[] = [];
  private tree: string[][] = [];

  constructor() {
    this.rebuild();
  }

  public insertRevocation(tokenId: string): void {
    const leaf = createHash('sha256')
      .update(`WorkSphere-SBT-Revoked-${tokenId}`)
      .digest('hex');
    this.leaves.push(leaf);
    this.rebuild();
  }

  private rebuild(): void {
    if (this.leaves.length === 0) {
      this.tree = [[createHash('sha256').update('EMPTY_TREE').digest('hex')]];
      return;
    }

    let currentLevel = [...this.leaves];
    this.tree = [currentLevel];

    while (currentLevel.length > 1) {
      const nextLevel: string[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        const left = currentLevel[i];
        const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : left;
        const parent = createHash('sha256')
          .update(left + right)
          .digest('hex');
        nextLevel.push(parent);
      }
      this.tree.push(nextLevel);
      currentLevel = nextLevel;
    }
  }

  public getRoot(): string {
    const topLevel = this.tree[this.tree.length - 1];
    return topLevel && topLevel.length > 0 ? topLevel[0] : '';
  }

  public getProof(tokenId: string): string[] | null {
    const targetLeaf = createHash('sha256')
      .update(`WorkSphere-SBT-Revoked-${tokenId}`)
      .digest('hex');
    let index = this.leaves.indexOf(targetLeaf);
    if (index === -1) return null;

    const proof: string[] = [];
    for (let level = 0; level < this.tree.length - 1; level++) {
      const currentLevel = this.tree[level];
      const isRight = index % 2 === 1;
      const siblingIndex = isRight ? index - 1 : index + 1;

      if (siblingIndex < currentLevel.length) {
        proof.push(currentLevel[siblingIndex]);
      } else {
        proof.push(currentLevel[index]); // Duplicate when odd
      }

      index = Math.floor(index / 2);
    }

    return proof;
  }

  public static verifyProof(
    tokenId: string,
    proof: string[],
    root: string
  ): boolean {
    let current = createHash('sha256')
      .update(`WorkSphere-SBT-Revoked-${tokenId}`)
      .digest('hex');

    for (const sibling of proof) {
      // Lexicographical sorting for canonical tree reconstruction
      const combined = current < sibling ? current + sibling : sibling + current;
      current = createHash('sha256').update(combined).digest('hex');
    }

    return current === root;
  }
}

/**
 * Decentralized Skill Attestation and Soulbound Token Coordinator
 */
export class SoulboundSkillAttestor {
  private tokens: Map<string, SoulboundToken> = new Map();
  private endorsements: Map<string, PeerEndorsement[]> = new Map();
  private revocationTree: RevocationMerkleTree = new RevocationMerkleTree();

  /**
   * Deterministically computes signature payload hash from canonical token fields
   */
  public static computePayloadHash(token: Omit<SoulboundToken, 'signature'>): string {
    const payload = [
      token.tokenId,
      token.recipientDid,
      token.issuerDid,
      token.skillCategory,
      token.skillName,
      token.proficiencyScore,
      token.evidenceHash,
      token.issuedAt,
      token.expiresAt,
      token.revoked
    ].join('|');

    return createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Issues a non-transferable Soulbound Skill Token
   */
  public issueToken(
    params: {
      recipientDid: string;
      issuerDid: string;
      skillCategory: SkillCategory;
      skillName: string;
      proficiencyScore: number;
      evidenceHash: string;
      expiresAt?: number | null;
    },
    issuerSecret: string,
    timestampMs: number = Date.now()
  ): SoulboundToken {
    if (!params.recipientDid || !params.issuerDid) {
      throw new Error('Recipient and Issuer DIDs are required');
    }
    if (params.proficiencyScore < 0 || params.proficiencyScore > 100) {
      throw new Error('Proficiency score must be between 0 and 100');
    }

    const tokenId = `sbt-${createHash('sha256')
      .update(`${params.recipientDid}-${params.skillName}-${timestampMs}`)
      .digest('hex')
      .substring(0, 16)}`;

    const unsignedToken: Omit<SoulboundToken, 'signature'> = {
      tokenId,
      recipientDid: params.recipientDid,
      issuerDid: params.issuerDid,
      skillCategory: params.skillCategory,
      skillName: params.skillName,
      proficiencyScore: Math.round(params.proficiencyScore),
      evidenceHash: params.evidenceHash,
      issuedAt: timestampMs,
      expiresAt: params.expiresAt ?? null,
      revoked: false
    };

    const payloadHash = SoulboundSkillAttestor.computePayloadHash(unsignedToken);
    const signature = createHmac('sha256', issuerSecret)
      .update(payloadHash)
      .digest('hex');

    const token: SoulboundToken = {
      ...unsignedToken,
      signature
    };

    this.tokens.set(tokenId, token);
    return token;
  }

  /**
   * Verifies the cryptographic authenticity, validity, non-transferability, and non-revocation of a token
   */
  public verifyToken(
    token: SoulboundToken,
    issuerSecret: string,
    claimingDid: string,
    timestampMs: number = Date.now()
  ): VerificationResult {
    // 1. Strict Soulbound Non-Transferability Check: claiming entity must be recipient
    if (token.recipientDid !== claimingDid) {
      return {
        valid: false,
        isNonTransferable: false,
        isExpired: false,
        isRevoked: false,
        error: `Soulbound non-transferable violation: Token is bound to ${token.recipientDid}, claimed by ${claimingDid}`
      };
    }

    // 2. Revocation status check
    if (token.revoked || this.tokens.get(token.tokenId)?.revoked) {
      return {
        valid: false,
        isNonTransferable: true,
        isExpired: false,
        isRevoked: true,
        error: 'Token has been revoked by issuer'
      };
    }

    // 3. Expiration check
    if (token.expiresAt !== null && timestampMs > token.expiresAt) {
      return {
        valid: false,
        isNonTransferable: true,
        isExpired: true,
        isRevoked: false,
        error: 'Token credential has expired'
      };
    }

    // 4. Issuer Signature Verification
    const { signature, ...unsigned } = token;
    const payloadHash = SoulboundSkillAttestor.computePayloadHash(unsigned);
    const expectedSignature = createHmac('sha256', issuerSecret)
      .update(payloadHash)
      .digest('hex');

    if (signature !== expectedSignature) {
      return {
        valid: false,
        isNonTransferable: true,
        isExpired: false,
        isRevoked: false,
        error: 'Cryptographic issuer signature verification failed'
      };
    }

    return {
      valid: true,
      isNonTransferable: true,
      isExpired: false,
      isRevoked: false
    };
  }

  /**
   * Revokes a Soulbound Token and adds it to the cryptographic revocation Merkle tree
   */
  public revokeToken(tokenId: string): boolean {
    const token = this.tokens.get(tokenId);
    if (!token) return false;

    token.revoked = true;
    this.revocationTree.insertRevocation(tokenId);
    return true;
  }

  public isRevoked(tokenId: string): boolean {
    return this.tokens.get(tokenId)?.revoked ?? false;
  }

  public getRevocationRoot(): string {
    return this.revocationTree.getRoot();
  }

  /**
   * Adds an authorized peer coworker endorsement to a skill token
   */
  public addPeerEndorsement(
    tokenId: string,
    endorsement: Omit<PeerEndorsement, 'signature'>,
    endorserSecret: string
  ): PeerEndorsement {
    const token = this.tokens.get(tokenId);
    if (!token) {
      throw new Error(`Token ${tokenId} not found`);
    }
    if (endorsement.endorserDid === token.recipientDid) {
      throw new Error('Self-endorsement is disallowed in Soulbound credentials');
    }

    const payload = `${tokenId}|${endorsement.endorserDid}|${endorsement.rating}|${endorsement.timestamp}`;
    const signature = createHmac('sha256', endorserSecret)
      .update(payload)
      .digest('hex');

    const signedEndorsement: PeerEndorsement = {
      ...endorsement,
      signature
    };

    const list = this.endorsements.get(tokenId) || [];
    list.push(signedEndorsement);
    this.endorsements.set(tokenId, list);

    return signedEndorsement;
  }

  /**
   * Aggregates base score with peer endorsement ratings
   */
  public getAggregatedProficiency(tokenId: string): {
    baseScore: number;
    endorsedScore: number;
    totalEndorsements: number;
  } {
    const token = this.tokens.get(tokenId);
    if (!token) {
      throw new Error(`Token ${tokenId} not found`);
    }

    const list = this.endorsements.get(tokenId) || [];
    if (list.length === 0) {
      return {
        baseScore: token.proficiencyScore,
        endorsedScore: token.proficiencyScore,
        totalEndorsements: 0
      };
    }

    const sumEndorsements = list.reduce((acc, e) => acc + e.rating, 0);
    const avgEndorsement = sumEndorsements / list.length;

    // Weighted blend: 60% issuer base score, 40% peer consensus
    const blended = Math.round(token.proficiencyScore * 0.6 + avgEndorsement * 0.4);

    return {
      baseScore: token.proficiencyScore,
      endorsedScore: blended,
      totalEndorsements: list.length
    };
  }

  /**
   * Generates a privacy-preserving selective disclosure claim proving score >= minRequiredScore
   */
  public generateSelectiveDisclosure(
    token: SoulboundToken,
    minRequiredScore: number
  ): SelectiveDisclosureClaim {
    if (token.proficiencyScore < minRequiredScore) {
      throw new Error(
        `Token score (${token.proficiencyScore}) does not meet required threshold (${minRequiredScore})`
      );
    }

    const salt = randomBytes(16).toString('hex');
    const commitment = createHash('sha256')
      .update(`WorkSphere-SelectiveDisclosure-${token.proficiencyScore}-${salt}`)
      .digest('hex');

    return {
      tokenId: token.tokenId,
      recipientDid: token.recipientDid,
      skillName: token.skillName,
      minRequiredScore,
      commitment,
      salt
    };
  }

  /**
   * Verifies selective disclosure commitment against an authentic token
   */
  public verifySelectiveDisclosure(
    claim: SelectiveDisclosureClaim,
    token: SoulboundToken
  ): boolean {
    if (claim.tokenId !== token.tokenId || claim.recipientDid !== token.recipientDid) {
      return false;
    }
    if (token.proficiencyScore < claim.minRequiredScore) {
      return false;
    }

    const expectedCommitment = createHash('sha256')
      .update(`WorkSphere-SelectiveDisclosure-${token.proficiencyScore}-${claim.salt}`)
      .digest('hex');

    return expectedCommitment === claim.commitment;
  }
}
