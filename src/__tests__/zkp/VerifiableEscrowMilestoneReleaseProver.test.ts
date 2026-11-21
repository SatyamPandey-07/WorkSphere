import { describe, it, expect } from 'vitest';
import { VerifiableEscrowMilestoneReleaseProver, SUBGROUP_Q } from '../../core/zkp/VerifiableEscrowMilestoneReleaseProver';

describe('VerifiableEscrowMilestoneReleaseProver', () => {
  const escrow = new VerifiableEscrowMilestoneReleaseProver();

  it('verifies staged arbiter-attested milestone releases and balance conservation chains', () => {
    const a1 = escrow.createArbiter('arb-legal');
    const a2 = escrow.createArbiter('arb-tech');
    const a3 = escrow.createArbiter('arb-finance');

    const v0 = escrow.openEscrow('grant-2026-zk', 1000n, [a1, a2, a3], 2, 12);

    const step1 = escrow.releaseMilestone(v0, 'M1-design', 'sha256:design-doc', 300n, [a1, a2]);
    expect(step1.nextVault.currentBalance).toBe(700n);

    const step2 = escrow.releaseMilestone(step1.nextVault, 'M2-prototype', 'sha256:proto-v1', 450n, [a2, a3]);
    expect(step2.nextVault.currentBalance).toBe(250n);

    const step3 = escrow.releaseMilestone(step2.nextVault, 'M3-audit', 'sha256:final-audit', 250n, [a1, a3]);
    expect(step3.nextVault.currentBalance).toBe(0n);

    expect(escrow.verifyReleaseChain(v0, [step1.certificate, step2.certificate, step3.certificate])).toBe(true);

    // Over-release throws; insufficient arbiters throws
    expect(() => escrow.releaseMilestone(step2.nextVault, 'M3-over', 'h', 251n, [a1, a2])).toThrow();
    expect(() => escrow.releaseMilestone(v0, 'M1-low-quorum', 'h', 100n, [a1])).toThrow();

    // Tampered attestation or conservation response fails verification
    expect(
      escrow.verifyReleaseCertificate(v0, {
        ...step1.certificate,
        conservationResponseR: (step1.certificate.conservationResponseR + 1n) % SUBGROUP_Q,
      }),
    ).toBe(false);
    expect(escrow.verifyReleaseChain(v0, [step1.certificate, step3.certificate])).toBe(false);

    const json = JSON.parse(escrow.serializeCertificate(step2.certificate)) as { milestoneId: string; arbiterCount: number };
    expect(json.milestoneId).toBe('M2-prototype');
    expect(json.arbiterCount).toBe(2);
  });
});
