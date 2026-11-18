import { describe, it, expect } from 'vitest';
import { VerifiableRandomFunctionECVRF } from '../../core/zkp/VerifiableRandomFunctionECVRF';

describe('VerifiableRandomFunctionECVRF', () => {
  const vrf = new VerifiableRandomFunctionECVRF();

  it('produces deterministic verifiable VRF proofs and rejects tampered gamma or inputs', () => {
    const kp = vrf.generateKeyPair(123456789n);
    const proofA = vrf.prove(kp, 'worksphere-epoch-101');
    const proofB = vrf.prove(kp, 'worksphere-epoch-101');

    expect(proofA.outputHex).toBe(proofB.outputHex);
    expect(proofA.gamma).toBe(proofB.gamma);
    expect(vrf.verify(proofA)).toBe(true);

    expect(vrf.verify({ ...proofA, input: 'worksphere-epoch-102' })).toBe(false);
    expect(vrf.verify({ ...proofA, gamma: proofA.gamma + 1n })).toBe(false);
    expect(vrf.verify({ ...proofA, responseS: proofA.responseS + 1n })).toBe(false);
    expect(vrf.verify({ ...proofA, outputHex: 'f'.repeat(64) })).toBe(false);
  });

  it('executes and publicly verifies weighted cryptographic sortition', () => {
    const kp = vrf.generateKeyPair(999111n);
    const sortition = vrf.evaluateSortition(kp, 'committee-round-7', 50, 100, 10);

    expect(vrf.verifySortition(sortition, 'committee-round-7', 10)).toBe(true);
    expect(vrf.verifySortition(sortition, 'committee-round-8', 10)).toBe(false);
    expect(
      vrf.verifySortition({ ...sortition, selectedSeats: sortition.selectedSeats + 1 }, 'committee-round-7', 10)
    ).toBe(false);
    expect(() => vrf.evaluateSortition(kp, 'r', 200, 100, 5)).toThrow();
  });

  it('selects the unbiased lowest-hash leader while filtering forged candidates', () => {
    const k1 = vrf.generateKeyPair(101n);
    const k2 = vrf.generateKeyPair(202n);
    const k3 = vrf.generateKeyPair(303n);
    const seed = 'leader-election-round-55';

    const p1 = vrf.prove(k1, seed);
    const p2 = vrf.prove(k2, seed);
    const forged = { ...vrf.prove(k3, seed), outputHex: '0'.repeat(64) };

    const election = vrf.selectLowestHashLeader(seed, [
      { participantId: 'node-1', proof: p1 },
      { participantId: 'node-2', proof: p2 },
      { participantId: 'node-forged', proof: forged },
    ]);

    expect(election.validParticipants).toEqual(['node-1', 'node-2']);
    expect(election.rejectedParticipants).toEqual(['node-forged']);
    const expectedWinner = p1.outputHex < p2.outputHex ? 'node-1' : 'node-2';
    expect(election.winnerId).toBe(expectedWinner);
  });

  it('batch-verifies VRF proofs and round-trips JSON serialization cleanly', () => {
    const k1 = vrf.generateKeyPair();
    const k2 = vrf.generateKeyPair();
    const p1 = vrf.prove(k1, 'alpha');
    const p2 = vrf.prove(k2, 'beta');

    const ok = vrf.batchVerify([p1, p2]);
    expect(ok.allValid).toBe(true);
    expect(ok.validCount).toBe(2);
    expect(ok.failedIndices).toEqual([]);
    expect(ok.aggregateOutputHash).toHaveLength(64);

    const bad = vrf.batchVerify([p1, { ...p2, challengeC: p2.challengeC + 1n }]);
    expect(bad.allValid).toBe(false);
    expect(bad.failedIndices).toEqual([1]);

    const encoded = vrf.serializeProof(p1);
    const decoded = vrf.deserializeProof(encoded);
    expect(decoded).toEqual(p1);
    expect(vrf.verify(decoded)).toBe(true);
  });
});
