import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeConfidentialPayrollProver, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgeConfidentialPayrollProver';

describe('ZeroKnowledgeConfidentialPayrollProver', () => {
  const payroll = new ZeroKnowledgeConfidentialPayrollProver();

  it('proves payroll conservation, salary band compliance, and aggregate tax reconciliation in zero knowledge', () => {
    const bundle = payroll.generatePayrollAudit(
      '2026-11-US',
      [
        { employeeId: 'emp-01', grossPay: 5000n, taxWithheld: 1250n, netPay: 3750n },
        { employeeId: 'emp-02', grossPay: 7200n, taxWithheld: 2160n, netPay: 5040n },
        { employeeId: 'emp-03', grossPay: 4100n, taxWithheld: 820n, netPay: 3280n },
      ],
      4000n,
      8000n,
    );

    expect(bundle.totalGrossDisbursed).toBe(16300n);
    expect(bundle.totalTaxRemitted).toBe(4230n);
    expect(bundle.totalNetPaid).toBe(12070n);
    expect(payroll.verifyPayrollAudit(bundle)).toBe(true);

    // Tampered tax aggregate or tightened maxSalary fails verification
    expect(payroll.verifyPayrollAudit({ ...bundle, totalTaxRemitted: 4231n, totalNetPaid: 12069n })).toBe(false);
    expect(payroll.verifyPayrollAudit({ ...bundle, maxSalary: 7000n })).toBe(false);
    expect(
      payroll.verifyPayrollAudit({
        ...bundle,
        grossAggregateOpening: {
          ...bundle.grossAggregateOpening,
          responseBlinding: (bundle.grossAggregateOpening.responseBlinding + 1n) % SUBGROUP_Q,
        },
      }),
    ).toBe(false);

    // Invalid employee gross != tax + net or out-of-band salary throws on proving
    expect(() =>
      payroll.generatePayrollAudit('bad', [{ employeeId: 'e1', grossPay: 5000n, taxWithheld: 1000n, netPay: 3999n }], 4000n, 6000n),
    ).toThrow();
    expect(() =>
      payroll.generatePayrollAudit('band', [{ employeeId: 'e1', grossPay: 9000n, taxWithheld: 2000n, netPay: 7000n }], 4000n, 8000n),
    ).toThrow();

    const json = JSON.parse(payroll.serializeBundle(bundle)) as { employeeCount: number; totalGrossDisbursed: string };
    expect(json.employeeCount).toBe(3);
    expect(json.totalGrossDisbursed).toBe('16300');
  });
});
