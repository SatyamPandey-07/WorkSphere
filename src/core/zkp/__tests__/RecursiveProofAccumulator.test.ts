import { describe, it, expect, beforeEach } from 'vitest';
import {
  RecursiveProofAccumulator,
  AccumulatorFieldMath,
  VenueMembershipProof,
  AccumulatedVerificationResult,
  ACCUMULATOR_PROTOCOL_VERSION,
  DOMAIN_SEPARATION_TAGS,
} from '../RecursiveProofAccumulator';

describe('RecursiveProofAccumulator', () => {
  const sampleProof: VenueMembershipProof = {
    venueId: 'venue_mit_lounge',
    circuitId: 'student_access_pass_v1',
    verificationKeyId: 'vk_student_membership_2026',
    epoch: 2026,
    proof: {
      pi_a: ['1001', '1002', '1'],
      pi_b: [
        ['2001', '2002'],
        ['2003', '2004'],
      ],
      pi_c: ['3001', '3002', '1'],
      protocol: 'groth16',
      curve: 'bn128',
    },
    publicSignals: ['0x11111111', '2026', '0x99999999'],
    nullifierHash: '0x99999999',
    universityRoot: '0x11111111',
  };

  const sampleProof2: VenueMembershipProof = {
    venueId: 'venue_stanford_hub',
    circuitId: 'student_access_pass_v1',
    verificationKeyId: 'vk_student_membership_2026',
    epoch: 2026,
    proof: {
      pi_a: ['4001', '4002', '1'],
      pi_b: [
        ['5001', '5002'],
        ['5003', '5004'],
      ],
      pi_c: ['6001', '6002', '1'],
      protocol: 'groth16',
      curve: 'bn128',
    },
    publicSignals: ['0x22222222', '2026', '0x88888888'],
    nullifierHash: '0x88888888',
    universityRoot: '0x22222222',
  };

  const sampleProof3: VenueMembershipProof = {
    venueId: 'venue_berkeley_lab',
    circuitId: 'student_access_pass_v1',
    verificationKeyId: 'vk_student_membership_2026',
    epoch: 2026,
    proof: {
      pi_a: ['7001', '7002', '1'],
      pi_b: [
        ['8001', '8002'],
        ['8003', '8004'],
      ],
      pi_c: ['9001', '9002', '1'],
      protocol: 'groth16',
      curve: 'bn128',
    },
    publicSignals: ['0x33333333', '2026', '0x77777777'],
    nullifierHash: '0x77777777',
    universityRoot: '0x33333333',
  };

  let accumulator: RecursiveProofAccumulator;

  beforeEach(() => {
    accumulator = new RecursiveProofAccumulator();
  });

  it('1. initializes an empty accumulator correctly', () => {
    expect(accumulator.count).toBe(0);
    expect(accumulator.circuitId).toBe('student_access_pass_v1');
    expect(accumulator.verificationKeyId).toBe('vk_student_membership_2026');
    expect(accumulator.epoch).toBe(2026);
    expect(accumulator.isFinalized).toBe(false);
    expect(accumulator.venues).toEqual([]);
    expect(accumulator.nullifiers).toEqual([]);

    const emptyRoot = accumulator.getStateRoot();
    expect(typeof emptyRoot).toBe('string');
    expect(emptyRoot.length).toBe(64);

    const finalizedEmpty = accumulator.finalize();
    expect(finalizedEmpty.proofCount).toBe(0);
    const verification = RecursiveProofAccumulator.verifyAccumulatedResult(finalizedEmpty);
    expect(verification.isValid).toBe(true);
    expect(verification.verifiedCount).toBe(0);
  });

  it('2. adds one valid membership proof and updates state', async () => {
    const trace = await accumulator.addProof(sampleProof);
    expect(trace.stepIndex).toBe(1);
    expect(trace.venueId).toBe('venue_mit_lounge');
    expect(trace.foldingChallenge).toBe(1n);
    expect(accumulator.count).toBe(1);
    expect(accumulator.venues).toEqual(['venue_mit_lounge']);
    expect(accumulator.nullifiers).toEqual(['0x99999999']);
  });

  it('3. adds multiple venue proofs sequentially', async () => {
    await accumulator.addProof(sampleProof);
    await accumulator.addProof(sampleProof2);
    await accumulator.addProof(sampleProof3);

    expect(accumulator.count).toBe(3);
    expect(accumulator.venues).toEqual([
      'venue_mit_lounge',
      'venue_stanford_hub',
      'venue_berkeley_lab',
    ]);
    expect(accumulator.nullifiers.length).toBe(3);
  });

  it('4. computes deterministic accumulated state roots', async () => {
    await accumulator.addProof(sampleProof);
    await accumulator.addProof(sampleProof2);
    const root1 = accumulator.getStateRoot();

    const accB = new RecursiveProofAccumulator();
    await accB.addProof(sampleProof);
    await accB.addProof(sampleProof2);
    const root2 = accB.getStateRoot();

    expect(root1).toBe(root2);
  });

  it('5. changes accumulated root when an additional proof is added', async () => {
    const emptyRoot = accumulator.getStateRoot();
    await accumulator.addProof(sampleProof);
    const root1 = accumulator.getStateRoot();
    await accumulator.addProof(sampleProof2);
    const root2 = accumulator.getStateRoot();

    expect(root1).not.toBe(emptyRoot);
    expect(root2).not.toBe(root1);
  });

  it('6. rejects malformed proof structures', async () => {
    const malformed = {
      ...sampleProof,
      proof: {
        ...sampleProof.proof,
        pi_a: ['only_one_coord'], // Invalid length
      },
    };

    await expect(accumulator.addProof(malformed as any)).rejects.toThrow(
      /pi_a must be an array of at least 2 coordinate strings/
    );

    const missingSignals = {
      ...sampleProof,
      publicSignals: [],
    };
    await expect(accumulator.addProof(missingSignals as any)).rejects.toThrow(
      /publicSignals must be a non-empty array/
    );
  });

  it('7. rejects invalid public inputs', async () => {
    const invalidSignalProof = {
      ...sampleProof,
      publicSignals: ['valid_signal', '   '], // empty whitespace signal
    };

    await expect(accumulator.addProof(invalidSignalProof as any)).rejects.toThrow(
      /publicSignal at index 1 is not a valid non-empty string/
    );
  });

  it('8. rejects incompatible circuit or verification-key identifiers', async () => {
    const wrongCircuit = {
      ...sampleProof,
      circuitId: 'some_other_circuit_v99',
    };
    await expect(accumulator.addProof(wrongCircuit)).rejects.toThrow(/Incompatible circuitId/);

    const wrongKey = {
      ...sampleProof,
      verificationKeyId: 'vk_untrusted_key_2025',
    };
    await expect(accumulator.addProof(wrongKey)).rejects.toThrow(
      /Incompatible verificationKeyId/
    );

    const wrongEpoch = {
      ...sampleProof,
      epoch: 2025,
    };
    await expect(accumulator.addProof(wrongEpoch)).rejects.toThrow(/Incompatible epoch/);
  });

  it('9. prevents duplicate proof insertion for the same venue', async () => {
    await accumulator.addProof(sampleProof);
    await expect(accumulator.addProof(sampleProof)).rejects.toThrow(/Duplicate proof for venue/);
  });

  it('10. detects and rejects tampered accumulated state', async () => {
    await accumulator.addProof(sampleProof);
    await accumulator.addProof(sampleProof2);
    const finalized = accumulator.finalize();

    // Tamper with state root
    const tamperedRoot: AccumulatedVerificationResult = {
      ...finalized,
      stateRoot: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    };
    const res1 = RecursiveProofAccumulator.verifyAccumulatedResult(tamperedRoot);
    expect(res1.isValid).toBe(false);
    expect(res1.reason).toMatch(/State root mismatch/);

    // Tamper with running accumulator in trace
    const tamperedTraces = finalized.stepTraces.map((t, idx) =>
      idx === 1 ? { ...t, runningAccumulator: t.runningAccumulator + 1n } : t
    );
    const tamperedTraceResult: AccumulatedVerificationResult = {
      ...finalized,
      stepTraces: tamperedTraces,
    };
    const res2 = RecursiveProofAccumulator.verifyAccumulatedResult(tamperedTraceResult);
    expect(res2.isValid).toBe(false);
    expect(res2.reason).toMatch(/Running accumulator mismatch/);
  });

  it('11. performs serialization and deserialization round trips accurately', async () => {
    await accumulator.addProof(sampleProof);
    await accumulator.addProof(sampleProof2);
    const finalized = accumulator.finalize();

    const serialized = RecursiveProofAccumulator.serialize(finalized);
    expect(typeof serialized).toBe('string');

    const deserialized = RecursiveProofAccumulator.deserialize(serialized);
    expect(deserialized.version).toBe(finalized.version);
    expect(deserialized.circuitId).toBe(finalized.circuitId);
    expect(deserialized.epoch).toBe(finalized.epoch);
    expect(deserialized.stateRoot).toBe(finalized.stateRoot);
    expect(deserialized.foldedCommitment).toBe(finalized.foldedCommitment);
    expect(deserialized.venues).toEqual(finalized.venues);
    expect(deserialized.nullifiers).toEqual(finalized.nullifiers);
    expect(deserialized.stepTraces.length).toBe(finalized.stepTraces.length);

    const verifyRestored = RecursiveProofAccumulator.verifyAccumulatedResult(deserialized);
    expect(verifyRestored.isValid).toBe(true);
    expect(verifyRestored.verifiedCount).toBe(2);
  });

  it('12. rejects malformed serialized accumulators', () => {
    expect(() => RecursiveProofAccumulator.deserialize('')).toThrow(
      /Deserialization failed: input must be a non-empty string/
    );
    expect(() => RecursiveProofAccumulator.deserialize('{invalid_json}')).toThrow(
      /Deserialization failed: invalid JSON syntax/
    );
    expect(() =>
      RecursiveProofAccumulator.deserialize(JSON.stringify({ version: 'unknown_version' }))
    ).toThrow(/unsupported protocol version/);
  });

  it('13. prevents replay attacks via duplicate nullifier reuse', async () => {
    await accumulator.addProof(sampleProof);

    // Second proof has a different venue, but uses the SAME nullifier (attempted double-spend)
    const duplicateNullifierProof: VenueMembershipProof = {
      ...sampleProof2,
      venueId: 'venue_different_location',
      nullifierHash: sampleProof.nullifierHash, // Reused nullifier
    };

    await expect(accumulator.addProof(duplicateNullifierProof)).rejects.toThrow(
      /Replay attack detected: nullifier/
    );
  });

  it('14. verifies valid accumulated results against specified parameters', async () => {
    await accumulator.addProof(sampleProof);
    await accumulator.addProof(sampleProof2);
    const finalized = accumulator.finalize();

    const verifyOk = RecursiveProofAccumulator.verifyAccumulatedResult(finalized, {
      circuitId: 'student_access_pass_v1',
      verificationKeyId: 'vk_student_membership_2026',
      epoch: 2026,
    });
    expect(verifyOk.isValid).toBe(true);
    expect(verifyOk.verifiedCount).toBe(2);
    expect(verifyOk.reconstructedStateRoot).toBe(finalized.stateRoot);

    // Reject on mismatched expected params
    const verifyMismatch = RecursiveProofAccumulator.verifyAccumulatedResult(finalized, {
      circuitId: 'expected_different_circuit',
    });
    expect(verifyMismatch.isValid).toBe(false);
    expect(verifyMismatch.reason).toMatch(/Mismatched circuitId/);
  });

  it('15. rejects invalid or tampered results with mismatched transcripts', async () => {
    await accumulator.addProof(sampleProof);
    const finalized = accumulator.finalize();

    const tamperedTranscript = {
      ...finalized,
      transcriptDigest: 'bad_digest',
    };
    const res = RecursiveProofAccumulator.verifyAccumulatedResult(tamperedTranscript);
    expect(res.isValid).toBe(false);
    expect(res.reason).toMatch(/Transcript digest mismatch/);
  });

  it('16. enforces individual cryptographic proof verification failure handling', async () => {
    const failingVerifierAcc = new RecursiveProofAccumulator({
      verifySingleProof: async (p) => {
        if (p.venueId === 'venue_stanford_hub') return false; // Simulated invalid proof
        return true;
      },
    });

    await failingVerifierAcc.addProof(sampleProof);
    await expect(failingVerifierAcc.addProof(sampleProof2)).rejects.toThrow(
      /Cryptographic proof verification failed for venue "venue_stanford_hub"/
    );
    expect(failingVerifierAcc.count).toBe(1);
  });

  it('17. enforces canonical and insertion-order policies deterministically', async () => {
    const accOrder1 = new RecursiveProofAccumulator();
    await accOrder1.addProof(sampleProof);
    await accOrder1.addProof(sampleProof2);
    const final1 = accOrder1.finalize();

    const accOrder2 = new RecursiveProofAccumulator();
    await accOrder2.addProof(sampleProof2);
    await accOrder2.addProof(sampleProof);
    const final2 = accOrder2.finalize();

    // Step-by-step linear folding is order-sensitive for trace folding challenges
    expect(final1.foldedCommitment).not.toBe(final2.foldedCommitment);
    // Both independently verify correctly
    expect(RecursiveProofAccumulator.verifyAccumulatedResult(final1).isValid).toBe(true);
    expect(RecursiveProofAccumulator.verifyAccumulatedResult(final2).isValid).toBe(true);
  });
});
