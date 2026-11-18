import { describe, it, expect } from 'vitest';
import { VerifiableTimeLockPuzzleBatchProver } from '../../core/zkp/VerifiableTimeLockPuzzleBatchProver';

describe('VerifiableTimeLockPuzzleBatchProver', () => {
  const tlp = new VerifiableTimeLockPuzzleBatchProver();

  it('generates, solves, and verifies individual sequential-squaring time-lock puzzles', () => {
    const puzzle = tlp.generatePuzzle('tlp-single-1', 'secret-launch-code-2026', 64);
    const sol = tlp.solveAndProvePuzzle(puzzle);

    expect(sol.recoveredPlaintext).toBe('secret-launch-code-2026');
    expect(tlp.verifySolution(sol)).toBe(true);
    expect(tlp.verifySolution({ ...sol, proofPi: sol.proofPi + 1n })).toBe(false);
    expect(tlp.verifySolution({ ...sol, outputY: sol.outputY + 1n })).toBe(false);
  });

  it('homomorphically aggregates N time-lock puzzles into ONE constant-size Wesolowski batch proof', () => {
    const items = [
      tlp.generatePuzzle('p1', 'alpha-payload', 48),
      tlp.generatePuzzle('p2', 'beta-payload', 48),
      tlp.generatePuzzle('p3', 'gamma-payload', 48),
      tlp.generatePuzzle('p4', 'delta-payload', 48),
    ];

    const { batchProof, recoveredPlaintexts } = tlp.aggregateBatchProof('tlp-batch-01', items);
    expect(recoveredPlaintexts.get('p1')).toBe('alpha-payload');
    expect(recoveredPlaintexts.get('p4')).toBe('delta-payload');
    expect(tlp.verifyBatchProof(batchProof)).toBe(true);

    // Tampering with any individual outputY must break the folded batch proof
    const badBatch = {
      ...batchProof,
      outputsY: [batchProof.outputsY[0], batchProof.outputsY[1] + 1n, batchProof.outputsY[2], batchProof.outputsY[3]],
    };
    expect(tlp.verifyBatchProof(badBatch)).toBe(false);

    const json = tlp.serializeBatchProof(batchProof);
    const restored = tlp.deserializeBatchProof(json);
    expect(restored).toEqual(batchProof);
    expect(tlp.verifyBatchProof(restored)).toBe(true);
  });
});
