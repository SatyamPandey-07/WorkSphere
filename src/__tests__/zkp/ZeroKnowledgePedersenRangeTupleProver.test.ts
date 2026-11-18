import { describe, it, expect } from 'vitest';
import { ZeroKnowledgePedersenRangeTupleProver, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgePedersenRangeTupleProver';

describe('ZeroKnowledgePedersenRangeTupleProver', () => {
  const prover = new ZeroKnowledgePedersenRangeTupleProver();

  it('proves multi-coordinate ranges and weighted aggregate bounds in zero knowledge', () => {
    const proof = prover.proveRangeTuple(
      [
        { name: 'latency_ms', value: 42n, min: 10n, max: 100n, weight: 2n },
        { name: 'cpu_pct', value: 65n, min: 0n, max: 80n, weight: 3n },
        { name: 'mem_gb', value: 12n, min: 4n, max: 32n, weight: 5n },
      ],
      300n, // weighted sum = 2*42 + 3*65 + 5*12 = 339
      400n,
      'sla-check-2026',
    );

    expect(prover.verifyRangeTuple(proof)).toBe(true);

    expect(prover.verifyRangeTuple({ ...proof, sumMax: 338n })).toBe(false);
    expect(prover.verifyRangeTuple({ ...proof, sumMin: 340n })).toBe(false);
    expect(prover.verifyRangeTuple({ ...proof, context: 'wrong-ctx' })).toBe(false);

    const meta = JSON.parse(prover.serializeProof(proof)) as { coordinateCount: number; names: string[] };
    expect(meta.coordinateCount).toBe(3);
    expect(meta.names).toEqual(['latency_ms', 'cpu_pct', 'mem_gb']);
  });

  it('handles exact boundary values (min == value, max == value, sumMin == sum == sumMax)', () => {
    const exactBoundary = prover.proveRangeTuple(
      [
        { name: 'floor_val', value: 10n, min: 10n, max: 50n, weight: 1n },
        { name: 'ceil_val', value: 25n, min: 5n, max: 25n, weight: 2n },
      ],
      60n,
      60n,
      'tight-bounds',
    );
    expect(prover.verifyRangeTuple(exactBoundary)).toBe(true);
    expect(prover.verifyRangeTuple({ ...exactBoundary, sumMin: 61n, sumMax: 60n })).toBe(false);
  });

  it('rejects out-of-bounds witnesses, empty specs, and tampered bit disjunction proofs', () => {
    expect(() => prover.proveRangeTuple([], 0n, 10n)).toThrow();
    expect(() =>
      prover.proveRangeTuple(
        [{ name: 'cpu_pct', value: 95n, min: 0n, max: 80n, weight: 1n }],
        0n,
        100n,
      ),
    ).toThrow();
    expect(() =>
      prover.proveRangeTuple(
        [{ name: 'cpu_pct', value: 50n, min: 0n, max: 80n, weight: 2n }],
        0n,
        90n, // weighted sum = 100 > 90
      ),
    ).toThrow();

    const proof = prover.proveRangeTuple(
      [{ name: 'risk', value: 15n, min: 5n, max: 30n, weight: 4n }],
      40n,
      80n,
      'risk-audit',
    );
    expect(prover.verifyRangeTuple(proof)).toBe(true);

    // Tamper weighted sum commitment
    expect(
      prover.verifyRangeTuple({
        ...proof,
        weightedSumCommitment: (proof.weightedSumCommitment * 4n) % SAFE_PRIME_P,
      }),
    ).toBe(false);

    // Tamper a single bit-disjunction response inside lowerGapProof
    const badCoord = {
      ...proof.coordinates[0],
      lowerGapProof: {
        ...proof.coordinates[0].lowerGapProof,
        bitProofs: proof.coordinates[0].lowerGapProof.bitProofs.map((bp, i) =>
          i === 0 ? { ...bp, s0: (bp.s0 + 1n) % SUBGROUP_Q } : bp,
        ),
      },
    };
    expect(prover.verifyRangeTuple({ ...proof, coordinates: [badCoord] })).toBe(false);
  });
});
