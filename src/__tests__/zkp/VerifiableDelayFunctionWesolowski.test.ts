import { describe, it, expect } from 'vitest';
import { VerifiableDelayFunctionWesolowski } from '../../core/zkp/VerifiableDelayFunctionWesolowski';

describe('VerifiableDelayFunctionWesolowski', () => {
  const vdf = new VerifiableDelayFunctionWesolowski();

  it('evaluates and verifies Wesolowski VDF proofs across different iteration counts', () => {
    const proof = vdf.evaluateAndProve('worksphere-round-42', 250);
    expect(vdf.verify(proof)).toBe(true);
    expect(vdf.verify({ ...proof, outputY: proof.outputY + 1n })).toBe(false);
    expect(vdf.verify({ ...proof, proofPi: proof.proofPi + 1n })).toBe(false);
    expect(vdf.verify({ ...proof, inputSeed: 'tampered-seed' })).toBe(false);
  });

  it('generates and verifies multi-epoch chained VDF randomness beacons', () => {
    const chain = vdf.generateBeaconChain('genesis-beacon-2026', 3, 100);
    expect(chain).toHaveLength(3);
    expect(vdf.verifyBeaconChain('genesis-beacon-2026', chain)).toBe(true);
    expect(vdf.verifyBeaconChain('wrong-genesis', chain)).toBe(false);

    const brokenChain = [
      chain[0],
      { ...chain[1], beaconRandomness: '0'.repeat(64) },
      chain[2],
    ];
    expect(vdf.verifyBeaconChain('genesis-beacon-2026', brokenChain)).toBe(false);
  });

  it('batch-verifies multiple proofs and isolates tampered indices', () => {
    const p1 = vdf.evaluateAndProve('batch-seed-1', 60);
    const p2 = vdf.evaluateAndProve('batch-seed-2', 80);
    const p3 = vdf.evaluateAndProve('batch-seed-3', 100);

    const ok = vdf.batchVerify([p1, p2, p3]);
    expect(ok.allValid).toBe(true);
    expect(ok.validCount).toBe(3);
    expect(ok.failedIndices).toEqual([]);
    expect(ok.totalIterationsVerified).toBe(240);
    expect(ok.batchDigest).toHaveLength(64);

    const bad = vdf.batchVerify([p1, { ...p2, outputY: p2.outputY + 3n }, p3]);
    expect(bad.allValid).toBe(false);
    expect(bad.validCount).toBe(2);
    expect(bad.failedIndices).toEqual([1]);
    expect(bad.totalIterationsVerified).toBe(160);
  });

  it('evaluates and verifies intermediate bisection checkpoints', () => {
    const { finalProof, checkpoints } = vdf.evaluateWithCheckpoints('checkpoint-seed', 120, 40);
    expect(checkpoints).toHaveLength(2);
    expect(checkpoints[0].step).toBe(40);
    expect(checkpoints[1].step).toBe(80);
    expect(vdf.verifyCheckpoints('checkpoint-seed', checkpoints, finalProof)).toBe(true);

    const tamperedCheckpoints = [
      checkpoints[0],
      { ...checkpoints[1], stateValue: checkpoints[1].stateValue + 1n },
    ];
    expect(vdf.verifyCheckpoints('checkpoint-seed', tamperedCheckpoints, finalProof)).toBe(false);
    expect(() => vdf.evaluateWithCheckpoints('checkpoint-seed', 100, 0)).toThrow();
  });

  it('derives deterministic unbiased selection indices and serializes proofs cleanly', () => {
    const proof = vdf.evaluateAndProve('lottery-epoch-9', 90);
    const pick1 = vdf.deriveUnbiasedSelection(proof, 16, 'slot-leader');
    const pick2 = vdf.deriveUnbiasedSelection(proof, 16, 'slot-leader');
    expect(pick1).toBe(pick2);
    expect(pick1).toBeGreaterThanOrEqual(0);
    expect(pick1).toBeLessThan(16);

    expect(() => vdf.deriveUnbiasedSelection({ ...proof, proofPi: proof.proofPi + 1n }, 16)).toThrow();

    const json = vdf.serializeProof(proof);
    const restored = vdf.deserializeProof(json);
    expect(restored).toEqual(proof);
    expect(vdf.verify(restored)).toBe(true);
  });
});
