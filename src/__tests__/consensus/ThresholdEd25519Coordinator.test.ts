import { describe, it, expect, beforeEach } from 'vitest';
import {
  ThresholdEd25519Coordinator,
  SessionPhase,
  ED25519_ORDER,
  type SignerParticipant,
} from '../../core/consensus/ThresholdEd25519Coordinator';

describe('ThresholdEd25519Coordinator - k-of-n Verifiable Multi-Signature Engine', () => {
  let coordinator: ThresholdEd25519Coordinator;

  const mockParticipants: SignerParticipant[] = [
    { id: 'signer_1', index: 1, publicKey: 'pubkey_01_hex' },
    { id: 'signer_2', index: 2, publicKey: 'pubkey_02_hex' },
    { id: 'signer_3', index: 3, publicKey: 'pubkey_03_hex' },
    { id: 'signer_4', index: 4, publicKey: 'pubkey_04_hex' },
    { id: 'signer_5', index: 5, publicKey: 'pubkey_05_hex' },
  ];

  beforeEach(() => {
    coordinator = new ThresholdEd25519Coordinator();
  });

  describe('Session Creation & Validation', () => {
    it('creates 3-of-5 threshold signing session successfully', () => {
      const session = coordinator.createSession({
        sessionId: 'session_vault_escrow_101',
        message: 'TRANSFER 5000 SOL TO ESCROW_TREASURY_ACCOUNT',
        threshold: 3,
        participants: mockParticipants,
        ttlMs: 30000,
      });

      expect(session.sessionId).toBe('session_vault_escrow_101');
      expect(session.threshold).toBe(3);
      expect(session.totalParticipants).toBe(5);
      expect(session.phase).toBe(SessionPhase.COMMITMENT_ROUND);
    });

    it('rejects invalid threshold configurations', () => {
      expect(() =>
        coordinator.createSession({
          sessionId: 'bad_threshold_session',
          message: 'msg',
          threshold: 6, // > 5 participants
          participants: mockParticipants,
        })
      ).toThrowError(/Invalid threshold/i);

      expect(() =>
        coordinator.createSession({
          sessionId: 'zero_threshold_session',
          message: 'msg',
          threshold: 0,
          participants: mockParticipants,
        })
      ).toThrowError(/Invalid threshold/i);
    });
  });

  describe('Lagrange Interpolation', () => {
    it('satisfies polynomial identity sum(lambda_i) = 1 mod L', () => {
      const subsetIndices = [1, 2, 4]; // 3-of-5 subset
      let sumLambda = 0n;

      for (const idx of subsetIndices) {
        const lambda = coordinator.computeLagrangeCoefficient(idx, subsetIndices);
        sumLambda = (sumLambda + lambda) % ED25519_ORDER;
      }

      expect(sumLambda).toBe(1n);
    });
  });

  describe('Two-Round Multi-Signature Protocol', () => {
    it('executes full Round 1 and Round 2 flow to generate valid group signature', () => {
      const message = 'TRANSFER 1000 USDC FOR DESK LEASE #402';
      const session = coordinator.createSession({
        sessionId: 'session_lease_402',
        message,
        threshold: 3,
        participants: mockParticipants,
      });

      // Round 1: Commitments from signers 1, 2, 3
      const c1 = coordinator.submitCommitment({
        sessionId: session.sessionId,
        participantId: 'signer_1',
        hidingCommitment: 'd1_commit_aabbcc',
        bindingCommitment: 'e1_commit_ddeeff',
      });
      expect(c1.readyForRound2).toBe(false);

      coordinator.submitCommitment({
        sessionId: session.sessionId,
        participantId: 'signer_2',
        hidingCommitment: 'd2_commit_112233',
        bindingCommitment: 'e2_commit_445566',
      });

      const c3 = coordinator.submitCommitment({
        sessionId: session.sessionId,
        participantId: 'signer_3',
        hidingCommitment: 'd3_commit_778899',
        bindingCommitment: 'e3_commit_aabb00',
      });

      // Threshold of 3 reached
      expect(c3.readyForRound2).toBe(true);
      expect(c3.phase).toBe(SessionPhase.SIGNATURE_ROUND);

      // Round 2: Signature shares
      const s1 = coordinator.submitSignatureShare({
        sessionId: session.sessionId,
        participantId: 'signer_1',
        shareZ: '0x1a2b3c4d5e6f',
      });
      expect(s1.phase).toBe(SessionPhase.SIGNATURE_ROUND);

      coordinator.submitSignatureShare({
        sessionId: session.sessionId,
        participantId: 'signer_2',
        shareZ: '0x2b3c4d5e6f7a',
      });

      const s3 = coordinator.submitSignatureShare({
        sessionId: session.sessionId,
        participantId: 'signer_3',
        shareZ: '0x3c4d5e6f7a8b',
      });

      expect(s3.phase).toBe(SessionPhase.COMPLETED);
      expect(s3.signature).toBeDefined();
      expect(s3.signature?.isValid).toBe(true);
      expect(s3.signature?.signersUsed).toEqual(['signer_1', 'signer_2', 'signer_3']);

      // Verification
      const isValid = coordinator.verifyGroupSignature(s3.signature!, message);
      expect(isValid).toBe(true);

      // Tampered message verification must fail
      const isTamperedValid = coordinator.verifyGroupSignature(s3.signature!, 'TAMPERED MESSAGE');
      expect(isTamperedValid).toBe(false);
    });
  });
});
