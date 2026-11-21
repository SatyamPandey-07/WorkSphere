import { describe, it, expect } from 'vitest';
import { ZeroKnowledgePrivateCreditScoreProver, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgePrivateCreditScoreProver';

describe('ZeroKnowledgePrivateCreditScoreProver', () => {
  const engine = new ZeroKnowledgePrivateCreditScoreProver();

  it('proves hidden weighted credit score meets prime-tier cutoff without revealing factors or exact score', () => {
    const rubric = {
      rubricId: 'prime-loan-v2026',
      baseOffset: 300n,
      tierCutoff: 720n,
      factors: [
        { factorId: 'payment_history', weight: 3n, minVal: 0n, maxVal: 100n },
        { factorId: 'utilization_inv', weight: 2n, minVal: 0n, maxVal: 100n },
        { factorId: 'account_age_yrs', weight: 5n, minVal: 0n, maxVal: 20n },
      ],
    };

    // Applicant score = 300 + 3*92 + 2*80 + 5*8 = 300 + 276 + 160 + 40 = 776 >= 720
    const proof = engine.proveCreditEligibility(rubric, 'anon-applicant-0x9f', {
      payment_history: 92n,
      utilization_inv: 80n,
      account_age_yrs: 8n,
    });
    expect(engine.verifyCreditEligibility(rubric, proof)).toBe(true);

    // Sub-threshold applicant (score = 300 + 150 + 100 + 10 = 560 < 720) throws
    expect(() =>
      engine.proveCreditEligibility(rubric, 'low-score', {
        payment_history: 50n,
        utilization_inv: 50n,
        account_age_yrs: 2n,
      }),
    ).toThrow();

    // Out-of-bounds factor cheating (payment_history = 150 > 100) throws
    expect(() =>
      engine.proveCreditEligibility(rubric, 'cheat-factor', {
        payment_history: 150n,
        utilization_inv: 0n,
        account_age_yrs: 0n,
      }),
    ).toThrow();

    // Raising rubric cutoff or tampering with surplus bit proof fails verification
    expect(engine.verifyCreditEligibility({ ...rubric, tierCutoff: 750n }, proof)).toBe(false);
    expect(
      engine.verifyCreditEligibility(rubric, {
        ...proof,
        surplusProof: {
          ...proof.surplusProof,
          bits: proof.surplusProof.bits.map((b, i) => (i === 0 ? { ...b, s0: (b.s0 + 1n) % SUBGROUP_Q } : b)),
        },
      }),
    ).toBe(false);

    const json = JSON.parse(engine.serializeProof(proof)) as { rubricId: string; factorCount: number };
    expect(json.rubricId).toBe('prime-loan-v2026');
    expect(json.factorCount).toBe(3);
  });
});
