/**
 * @file SoulboundSkillAttestor.test.ts
 * @description Comprehensive unit tests for Decentralized Skill Attestation,
 * EIP-5114 non-transferable Soulbound Tokens, Merkle Revocation Accumulators, and Peer Endorsements.
 */

import {
  SoulboundSkillAttestor,
  RevocationMerkleTree,
  SoulboundToken,
} from '../../core/culture/SoulboundSkillAttestor';

describe('SoulboundSkillAttestor & Non-Transferable Reputation Suite', () => {
  const issuerSecret = 'master-issuer-key-5114';
  const issuerDid = 'did:key:z6MkuTf9issuer';
  const recipientDid = 'did:key:z6MkwG4recipient';

  describe('RevocationMerkleTree', () => {
    it('constructs non-empty Merkle root and generates valid inclusion proofs', () => {
      const tree = new RevocationMerkleTree();
      expect(tree.getRoot().length).toBe(64);

      tree.insertRevocation('sbt-001');
      tree.insertRevocation('sbt-002');
      tree.insertRevocation('sbt-003');

      const root = tree.getRoot();
      expect(root.length).toBe(64);

      const proof = tree.getProof('sbt-002');
      expect(proof).not.toBeNull();
      expect(proof!.length).toBeGreaterThan(0);
    });

    it('returns null proof for non-revoked token', () => {
      const tree = new RevocationMerkleTree();
      tree.insertRevocation('sbt-001');
      expect(tree.getProof('sbt-unrevoked')).toBeNull();
    });
  });

  describe('Soulbound Token Issuance & Verification', () => {
    it('issues valid Soulbound Token and verifies with matching recipient DID', () => {
      const attestor = new SoulboundSkillAttestor();
      const token = attestor.issueToken(
        {
          recipientDid,
          issuerDid,
          skillCategory: 'engineering',
          skillName: 'Zero-Knowledge Cryptography',
          proficiencyScore: 95,
          evidenceHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
        issuerSecret
      );

      expect(token.tokenId.startsWith('sbt-')).toBe(true);
      expect(token.recipientDid).toBe(recipientDid);
      expect(token.proficiencyScore).toBe(95);
      expect(token.signature.length).toBe(64);

      const res = attestor.verifyToken(token, issuerSecret, recipientDid);
      expect(res.valid).toBe(true);
      expect(res.isNonTransferable).toBe(true);
      expect(res.isRevoked).toBe(false);
      expect(res.isExpired).toBe(false);
    });

    it('strictly enforces non-transferability (fails when claimed by different DID)', () => {
      const attestor = new SoulboundSkillAttestor();
      const token = attestor.issueToken(
        {
          recipientDid,
          issuerDid,
          skillCategory: 'security',
          skillName: 'Smart Contract Auditing',
          proficiencyScore: 90,
          evidenceHash: 'a'.repeat(64),
        },
        issuerSecret
      );

      // Attempt to claim by another identity
      const attackerDid = 'did:key:z6MktAttacker';
      const res = attestor.verifyToken(token, issuerSecret, attackerDid);

      expect(res.valid).toBe(false);
      expect(res.isNonTransferable).toBe(false);
      expect(res.error).toContain('Soulbound non-transferable violation');
    });

    it('rejects verification if token payload has been tampered', () => {
      const attestor = new SoulboundSkillAttestor();
      const token = attestor.issueToken(
        {
          recipientDid,
          issuerDid,
          skillCategory: 'engineering',
          skillName: 'Distributed Consensus',
          proficiencyScore: 75,
          evidenceHash: 'b'.repeat(64),
        },
        issuerSecret
      );

      // Tamper proficiency score
      const tampered: SoulboundToken = {
        ...token,
        proficiencyScore: 99,
      };

      const res = attestor.verifyToken(tampered, issuerSecret, recipientDid);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('signature verification failed');
    });

    it('rejects expired credentials', () => {
      const attestor = new SoulboundSkillAttestor();
      const past = Date.now() - 10000;
      const token = attestor.issueToken(
        {
          recipientDid,
          issuerDid,
          skillCategory: 'operations',
          skillName: 'Cloud SRE',
          proficiencyScore: 85,
          evidenceHash: 'c'.repeat(64),
          expiresAt: past,
        },
        issuerSecret
      );

      const res = attestor.verifyToken(token, issuerSecret, recipientDid, Date.now());
      expect(res.valid).toBe(false);
      expect(res.isExpired).toBe(true);
      expect(res.error).toContain('credential has expired');
    });

    it('revokes token and blocks subsequent verification', () => {
      const attestor = new SoulboundSkillAttestor();
      const token = attestor.issueToken(
        {
          recipientDid,
          issuerDid,
          skillCategory: 'leadership',
          skillName: 'Technical Strategy',
          proficiencyScore: 88,
          evidenceHash: 'd'.repeat(64),
        },
        issuerSecret
      );

      expect(attestor.isRevoked(token.tokenId)).toBe(false);

      const revoked = attestor.revokeToken(token.tokenId);
      expect(revoked).toBe(true);
      expect(attestor.isRevoked(token.tokenId)).toBe(true);
      expect(attestor.getRevocationRoot().length).toBe(64);

      const res = attestor.verifyToken(token, issuerSecret, recipientDid);
      expect(res.valid).toBe(false);
      expect(res.isRevoked).toBe(true);
    });
  });

  describe('Peer Endorsements & Aggregated Scoring', () => {
    it('aggregates coworker endorsements into blended score', () => {
      const attestor = new SoulboundSkillAttestor();
      const token = attestor.issueToken(
        {
          recipientDid,
          issuerDid,
          skillCategory: 'engineering',
          skillName: 'TypeScript Compiler Architecture',
          proficiencyScore: 80, // Base score 80
          evidenceHash: 'e'.repeat(64),
        },
        issuerSecret
      );

      // Initial score with 0 endorsements
      expect(attestor.getAggregatedProficiency(token.tokenId)).toEqual({
        baseScore: 80,
        endorsedScore: 80,
        totalEndorsements: 0,
      });

      // Peer endorsement: 100 rating
      attestor.addPeerEndorsement(
        token.tokenId,
        {
          endorserDid: 'did:key:z6MksPeerCoworker',
          rating: 100,
          comment: 'Outstanding contribution to AST parser',
          timestamp: Date.now(),
        },
        'peer-secret-1'
      );

      // Weighted: 80 * 0.6 + 100 * 0.4 = 48 + 40 = 88
      const agg = attestor.getAggregatedProficiency(token.tokenId);
      expect(agg.baseScore).toBe(80);
      expect(agg.endorsedScore).toBe(88);
      expect(agg.totalEndorsements).toBe(1);
    });

    it('disallows self-endorsement', () => {
      const attestor = new SoulboundSkillAttestor();
      const token = attestor.issueToken(
        {
          recipientDid,
          issuerDid,
          skillCategory: 'design',
          skillName: 'Design Systems',
          proficiencyScore: 85,
          evidenceHash: 'f'.repeat(64),
        },
        issuerSecret
      );

      expect(() => {
        attestor.addPeerEndorsement(
          token.tokenId,
          {
            endorserDid: recipientDid, // Self endorsement!
            rating: 100,
            comment: 'I am great',
            timestamp: Date.now(),
          },
          'some-secret'
        );
      }).toThrow(/Self-endorsement is disallowed/);
    });
  });

  describe('Selective Disclosure Commitments', () => {
    it('generates and verifies selective disclosure proof of score >= threshold', () => {
      const attestor = new SoulboundSkillAttestor();
      const token = attestor.issueToken(
        {
          recipientDid,
          issuerDid,
          skillCategory: 'security',
          skillName: 'Penetration Testing',
          proficiencyScore: 92,
          evidenceHash: '1'.repeat(64),
        },
        issuerSecret
      );

      // Prove proficiency >= 80 without revealing exact score 92
      const claim = attestor.generateSelectiveDisclosure(token, 80);
      expect(claim.commitment.length).toBe(64);
      expect(claim.minRequiredScore).toBe(80);

      const isValid = attestor.verifySelectiveDisclosure(claim, token);
      expect(isValid).toBe(true);
    });

    it('rejects selective disclosure generation when score is below threshold', () => {
      const attestor = new SoulboundSkillAttestor();
      const token = attestor.issueToken(
        {
          recipientDid,
          issuerDid,
          skillCategory: 'engineering',
          skillName: 'Rust Low-Level Memory',
          proficiencyScore: 70,
          evidenceHash: '2'.repeat(64),
        },
        issuerSecret
      );

      // Attempting to prove >= 80 when score is only 70 throws error
      expect(() => {
        attestor.generateSelectiveDisclosure(token, 80);
      }).toThrow(/does not meet required threshold/);
    });
  });
});
