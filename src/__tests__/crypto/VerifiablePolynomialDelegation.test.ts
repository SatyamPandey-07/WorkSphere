import { describe, it, expect } from 'vitest';
import {
  VerifiablePolynomialDelegation,
  DelegationFieldMath,
  DELEGATION_PRIME,
} from '../../core/crypto/VerifiablePolynomialDelegation';

describe('VerifiablePolynomialDelegation', () => {
  const engine = new VerifiablePolynomialDelegation();
  const srs = engine.setup(64, 42n);

  it('performs accurate modular arithmetic', () => {
    const a = 123456789n;
    const invA = DelegationFieldMath.inv(a);
    expect(DelegationFieldMath.mul(a, invA)).toBe(1n);
  });

  it('correctly evaluates polynomials and generates commitments', () => {
    // P(X) = 5 + 3X + 2X^2
    const poly = [5n, 3n, 2n];
    const commitment = engine.commitPolynomial(poly);

    // Expected commitment with tau = 42: 5 + 3*(42) + 2*(42^2) = 5 + 126 + 3528 = 3659
    expect(commitment).toBe(3659n);

    // Direct evaluation at z = 7: 5 + 3*7 + 2*49 = 5 + 21 + 98 = 124
    const val = engine.evaluatePolynomial(poly, 7n);
    expect(val).toBe(124n);
  });

  it('proves and verifies outsourced polynomial evaluation in O(1)', () => {
    const poly = [17n, 29n, 31n, 43n]; // degree 3
    const commitment = engine.commitPolynomial(poly);
    const z = 13n;

    const task = engine.createTask('task-001', commitment, z);
    const proof = engine.computeAndProve('task-001', poly, z);

    expect(proof.degree).toBe(3);
    const result = engine.verifyDelegation(task, proof);
    expect(result.isValid).toBe(true);
    expect(result.evaluationPoint).toBe(13n);
  });

  it('rejects tampered evaluated values', () => {
    const poly = [10n, 20n, 30n];
    const commitment = engine.commitPolynomial(poly);
    const z = 5n;

    const task = engine.createTask('task-tamper', commitment, z);
    const proof = engine.computeAndProve('task-tamper', poly, z);

    // Tamper with evaluated value
    const tamperedProof = {
      ...proof,
      evaluatedValue: DelegationFieldMath.add(proof.evaluatedValue, 1n),
    };

    const result = engine.verifyDelegation(task, tamperedProof);
    expect(result.isValid).toBe(false);
  });

  it('verifies a batch of independent polynomial delegations', () => {
    const poly1 = [7n, 11n, 13n];
    const poly2 = [19n, 23n, 29n, 31n];

    const comm1 = engine.commitPolynomial(poly1);
    const comm2 = engine.commitPolynomial(poly2);

    const task1 = engine.createTask('t1', comm1, 3n);
    const task2 = engine.createTask('t2', comm2, 5n);

    const proof1 = engine.computeAndProve('t1', poly1, 3n);
    const proof2 = engine.computeAndProve('t2', poly2, 5n);

    const batchRes = engine.batchVerify([task1, task2], [proof1, proof2]);
    expect(batchRes.isValid).toBe(true);
  });
});
