import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeLinearCombinationVerifier, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgeLinearCombinationVerifier';

describe('ZeroKnowledgeLinearCombinationVerifier', () => {
  const verifier = new ZeroKnowledgeLinearCombinationVerifier();

  it('proves multi-equation affine systems over Pedersen commitments in O(M+N) group operations', () => {
    const x1 = verifier.commitVariable('x1', 15n);
    const x2 = verifier.commitVariable('x2', 22n);
    const x3 = verifier.commitVariable('x3', 8n);
    const vars = [x1, x2, x3];

    // Eq 1: 2*x1 + 3*x2 - x3 + 5 = 30 + 66 - 8 + 5 = 93
    const y1 = verifier.commitVariable('y1', 93n);
    // Eq 2: 4*x1 + 0*x2 + 5*x3 + 0 = 60 + 40 = 100
    const y2 = verifier.commitVariable('y2', 100n);
    // Eq 3: x1 + x2 + x3 - 45 = 0 (exact conservation check)
    const y3 = verifier.commitVariable('y3', 0n);

    const proof = verifier.proveAffineSystem(
      vars,
      [
        { id: 'eq-1', coefficients: [2n, 3n, -1n], constantOffset: 5n, targetOutput: y1 },
        { id: 'eq-2', coefficients: [4n, 0n, 5n], constantOffset: 0n, targetOutput: y2 },
        { id: 'eq-3', coefficients: [1n, 1n, 1n], constantOffset: -45n, targetOutput: y3 },
      ],
      'accounting-invariants-2026',
    );

    expect(verifier.verifyAffineSystem(proof)).toBe(true);
    expect(verifier.verifyBatch([proof])).toEqual({ allValid: true, failedIndices: [] });

    const meta = JSON.parse(verifier.serializeProof(proof)) as { variableCount: number; equationCount: number };
    expect(meta.variableCount).toBe(3);
    expect(meta.equationCount).toBe(3);
  });

  it('rejects unsatisfied equations, dimension mismatches, and tampered proof fields', () => {
    const x1 = verifier.commitVariable('a', 10n);
    const x2 = verifier.commitVariable('b', 20n);
    const wrongY = verifier.commitVariable('y', 999n);
    const rightY = verifier.commitVariable('y', 50n); // 3*10 + 1*20 = 50

    expect(() => verifier.proveAffineSystem([], [])).toThrow();
    expect(() =>
      verifier.proveAffineSystem([x1, x2], [{ id: 'bad', coefficients: [3n, 1n], constantOffset: 0n, targetOutput: wrongY }]),
    ).toThrow();
    expect(() =>
      verifier.proveAffineSystem([x1, x2], [{ id: 'len', coefficients: [3n], constantOffset: 0n, targetOutput: rightY }]),
    ).toThrow();

    const proof = verifier.proveAffineSystem(
      [x1, x2],
      [{ id: 'ok', coefficients: [3n, 1n], constantOffset: 0n, targetOutput: rightY }],
      'strict-affine',
    );
    expect(verifier.verifyAffineSystem(proof)).toBe(true);

    expect(verifier.verifyAffineSystem({ ...proof, context: 'wrong' })).toBe(false);
    expect(verifier.verifyAffineSystem({ ...proof, foldingGamma: (proof.foldingGamma + 1n) % SUBGROUP_Q })).toBe(false);
    expect(verifier.verifyAffineSystem({ ...proof, responseBlinding: (proof.responseBlinding + 1n) % SUBGROUP_Q })).toBe(false);
    expect(verifier.verifyAffineSystem({ ...proof, announcementR: (proof.announcementR * 4n) % SAFE_PRIME_P })).toBe(false);

    const badVar = [(proof.variableCommitments[0] * 4n) % SAFE_PRIME_P, proof.variableCommitments[1]];
    expect(verifier.verifyAffineSystem({ ...proof, variableCommitments: badVar })).toBe(false);

    const badEq = [{ ...proof.equations[0], constantOffset: 1n }];
    expect(verifier.verifyAffineSystem({ ...proof, equations: badEq })).toBe(false);
    expect(verifier.verifyBatch([proof, { ...proof, equations: badEq }])).toEqual({ allValid: false, failedIndices: [1] });
  });

  it('handles public zero-blinding targets, large 6-variable 5-equation systems, and negative modular offsets', () => {
    const vars = [
      verifier.commitVariable('v0', 100n),
      verifier.commitVariable('v1', 250n),
      verifier.commitVariable('v2', 75n),
      verifier.commitVariable('v3', 40n),
      verifier.commitVariable('v4', 15n),
      verifier.commitVariable('v5', 320n),
    ];

    const coeffRows = [
      [1n, 1n, 1n, 1n, 1n, 1n],
      [2n, -1n, 3n, 0n, 5n, -1n],
      [0n, 4n, -2n, 7n, 1n, 1n],
      [3n, 2n, 1n, -4n, 6n, 2n],
      [-1n, 0n, 0n, 0n, 0n, 1n],
    ];
    const offsets = [0n, 17n, -33n, 100n, -220n];

    const eqSpecs = coeffRows.map((coefficients, idx) => {
      const val = verifier.evaluateAffine(coefficients, vars, offsets[idx]);
      // Alternate between public (blinding=0) and hidden targets
      const targetOutput = verifier.commitVariable(`out-${idx}`, val, idx % 2 === 0 ? 0n : undefined);
      return { id: `sys-eq-${idx}`, coefficients, constantOffset: offsets[idx], targetOutput };
    });

    const proof = verifier.proveAffineSystem(vars, eqSpecs, 'large-6x5-system');
    expect(verifier.verifyAffineSystem(proof)).toBe(true);
    expect(verifier.verifyAffineSystem({ ...proof, equations: [] })).toBe(false);
    expect(verifier.verifyAffineSystem({ ...proof, variableCommitments: [] })).toBe(false);
    expect(verifier.verifyAffineSystem({ ...proof, challenge: (proof.challenge + 1n) % SUBGROUP_Q })).toBe(false);
  });

  it('reuses the same committed variables across independent domain contexts cleanly', () => {
    const x = verifier.commitVariable('shared-x', 77n);
    const y = verifier.commitVariable('shared-y', 231n);
    const p1 = verifier.proveAffineSystem([x], [{ id: 's1', coefficients: [3n], constantOffset: 0n, targetOutput: y }], 'dom-1');
    const p2 = verifier.proveAffineSystem([x], [{ id: 's1', coefficients: [3n], constantOffset: 0n, targetOutput: y }], 'dom-2');
    expect(p1.foldingGamma).not.toBe(p2.foldingGamma);
    expect(verifier.verifyBatch([p1, p2])).toEqual({ allValid: true, failedIndices: [] });
  });
});
