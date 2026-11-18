import { describe, it, expect } from 'vitest';
import { VerifiablePolynomialEvalInterpolator, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/VerifiablePolynomialEvalInterpolator';

describe('VerifiablePolynomialEvalInterpolator', () => {
  const engine = new VerifiablePolynomialEvalInterpolator();

  it('interpolates exact Lagrange polynomials over F_Q and verifies folded consistency + fresh openings', () => {
    // Ground-truth quadratic: P(x) = 7 + 3x + 5x^2
    const points = [
      { x: 0n, y: 7n },
      { x: 2n, y: 33n },
      { x: 5n, y: 147n },
    ];

    const committed = engine.commitInterpolated(points);
    expect(committed.coefficients).toEqual([7n, 3n, 5n]);

    const consProof = engine.proveInterpolationConsistency(points, committed, 'reed-solomon-check');
    expect(engine.verifyInterpolationConsistency(consProof)).toBe(true);

    const badPoints = points.map((p, idx) => (idx === 1 ? { ...p, y: p.y + 1n } : p));
    expect(engine.verifyInterpolationConsistency({ ...consProof, points: badPoints })).toBe(false);

    const evalProof = engine.provePointEvaluation(committed, 10n, 'query-10');
    expect(evalProof.claimedY).toBe(537n);
    expect(engine.verifyPointEvaluation(evalProof)).toBe(true);
    expect(engine.verifyPointEvaluation({ ...evalProof, claimedY: 538n })).toBe(false);

    const json = JSON.parse(engine.serializeConsistencyProof(consProof)) as { pointCount: number; degree: number };
    expect(json.pointCount).toBe(3);
    expect(json.degree).toBe(2);
  });

  it('handles higher-degree cubic interpolation, single-point constant, and rejects malformed/tampered proofs', () => {
    expect(() => engine.interpolate([])).toThrow();
    expect(() => engine.interpolate([{ x: 3n, y: 1n }, { x: 3n, y: 2n }])).toThrow();

    // Constant single point P(x) = 99
    const constComm = engine.commitInterpolated([{ x: 4n, y: 99n }]);
    expect(constComm.coefficients).toEqual([99n]);
    expect(engine.verifyPointEvaluation(engine.provePointEvaluation(constComm, 12345n, 'const-eval'))).toBe(true);

    // Cubic: P(x) = 2 + 4x + x^2 + 3x^3
    const poly = [2n, 4n, 1n, 3n];
    const pts = [1n, 3n, 6n, 9n].map((x) => ({ x, y: engine.evalPoly(poly, x) }));
    const committed = engine.commitInterpolated(pts);
    expect(committed.coefficients).toEqual(poly);

    const cons = engine.proveInterpolationConsistency(pts, committed, 'cubic-ctx');
    expect(engine.verifyInterpolationConsistency(cons)).toBe(true);
    expect(engine.verifyInterpolationConsistency({ ...cons, context: 'wrong' })).toBe(false);
    expect(engine.verifyInterpolationConsistency({ ...cons, foldingAlpha: (cons.foldingAlpha + 1n) % SUBGROUP_Q })).toBe(false);
    expect(engine.verifyInterpolationConsistency({ ...cons, responseBlinding: (cons.responseBlinding + 1n) % SUBGROUP_Q })).toBe(false);
    expect(engine.verifyInterpolationConsistency({ ...cons, announcementR: (cons.announcementR * 4n) % SAFE_PRIME_P })).toBe(false);

    const open = engine.provePointEvaluation(committed, 20n, 'open-20');
    expect(engine.verifyPointEvaluation(open)).toBe(true);
    expect(engine.verifyPointEvaluation({ ...open, context: 'bad' })).toBe(false);
    expect(engine.verifyPointEvaluation({ ...open, responseBlinding: (open.responseBlinding + 1n) % SUBGROUP_Q })).toBe(false);
  });
});
