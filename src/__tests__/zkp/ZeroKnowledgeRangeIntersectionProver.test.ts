import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeRangeIntersectionProver } from '../../core/zkp/ZeroKnowledgeRangeIntersectionProver';

describe('ZeroKnowledgeRangeIntersectionProver', () => {
  const prover = new ZeroKnowledgeRangeIntersectionProver();

  it('proves a hidden value lies inside the intersection of multiple policy intervals', () => {
    const intervals = [
      { intervalId: 'policy-budget', lowerBound: 100n, upperBound: 500n },
      { intervalId: 'policy-sla', lowerBound: 200n, upperBound: 420n },
      { intervalId: 'policy-dept', lowerBound: 180n, upperBound: 350n },
    ];
    // Intersection is [200, 350]
    const secret = prover.commitValue('kpi-metric', 275n);
    const proof = prover.proveInRangeIntersection('ri-01', secret, intervals, 10);

    expect(proof.effectiveLower).toBe(200n);
    expect(proof.effectiveUpper).toBe(350n);
    expect(prover.verifyRangeIntersection(proof).valid).toBe(true);

    // Tampered effective upper bound must fail
    expect(prover.verifyRangeIntersection({ ...proof, effectiveUpper: 360n }).valid).toBe(false);
    expect(
      prover.verifyRangeIntersection({
        ...proof,
        lowerDeltaProof: {
          ...proof.lowerDeltaProof,
          linkResponse: proof.lowerDeltaProof.linkResponse + 1n,
        },
      }).valid
    ).toBe(false);
  });

  it('rejects out-of-range values and empty interval intersections', () => {
    const emptyIntervals = [
      { intervalId: 'a', lowerBound: 10n, upperBound: 50n },
      { intervalId: 'b', lowerBound: 60n, upperBound: 100n },
    ];
    const s = prover.commitValue('x', 55n);
    expect(() => prover.proveInRangeIntersection('empty', s, emptyIntervals, 10)).toThrow();

    const validIntervals = [{ intervalId: 'ok', lowerBound: 100n, upperBound: 200n }];
    expect(() => prover.proveInRangeIntersection('outside', s, validIntervals, 10)).toThrow();
  });

  it('proves confidential two-value proximity tolerance and round-trips serialization', () => {
    const a = prover.commitValue('sensor-a', 520n);
    const b = prover.commitValue('sensor-b', 495n);
    const prox = prover.proveProximityTolerance('prox-1', a, b, 30n, 10);
    expect(prover.verifyProximityTolerance(prox)).toBe(true);
    expect(prover.verifyProximityTolerance({ ...prox, maxDelta: 10n })).toBe(false);

    expect(() => prover.proveProximityTolerance('prox-fail', a, b, 10n, 10)).toThrow();

    const intervals = [{ intervalId: 'band', lowerBound: 400n, upperBound: 600n }];
    const proof = prover.proveInRangeIntersection('ri-ser', a, intervals, 10);
    const json = prover.serializeIntersectionProof(proof);
    const restored = prover.deserializeIntersectionProof(json);
    expect(prover.verifyRangeIntersection(restored).valid).toBe(true);
  });
});
