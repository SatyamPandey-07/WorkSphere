import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeBalanceSheetAuditProver, SAFE_PRIME_P, SUBGROUP_Q } from '../../core/zkp/ZeroKnowledgeBalanceSheetAuditProver';

describe('ZeroKnowledgeBalanceSheetAuditProver', () => {
  it('proves solvency (Assets >= Liabilities) and verifies individual customer liability inclusions', () => {
    const auditor = new ZeroKnowledgeBalanceSheetAuditProver();
    auditor.buildLiabilityTree([
      { accountId: 'user-alice', balance: 1200n },
      { accountId: 'user-bob', balance: 3500n },
      { accountId: 'user-carol', balance: 850n },
      { accountId: 'user-dave', balance: 2450n },
      { accountId: 'user-eve', balance: 500n },
    ]);

    const bobInc = auditor.proveCustomerInclusion('user-bob');
    expect(auditor.verifyCustomerInclusion(bobInc)).toBe(true);
    expect(auditor.verifyCustomerInclusion({ ...bobInc, balance: 3501n })).toBe(false);

    expect(() => auditor.generateSolvencyProof('2026-Q4', 8499n, 20)).toThrow();

    const solvency = auditor.generateSolvencyProof('2026-Q4', 10250n, 20);
    expect(auditor.verifySolvencyProof(solvency)).toBe(true);
    expect(solvency.liabilityRootHash).toBe(bobInc.liabilityRootHash);

    expect(auditor.verifySolvencyProof({ ...solvency, auditEpoch: '2027-Q1' })).toBe(false);
    expect(
      auditor.verifySolvencyProof({
        ...solvency,
        assetCommitment: (solvency.assetCommitment * 4n) % SAFE_PRIME_P,
      }),
    ).toBe(false);

    const json = JSON.parse(auditor.serializeAudit(solvency)) as { accountCount: number; auditEpoch: string };
    expect(json.accountCount).toBe(5);
    expect(json.auditEpoch).toBe('2026-Q4');
  });

  it('supports exact zero-equity solvency (Assets == Liabilities) and verifies every account inclusion', () => {
    const auditor = new ZeroKnowledgeBalanceSheetAuditProver();
    const accounts = [
      { accountId: 'acct-0', balance: 0n },
      { accountId: 'acct-1', balance: 1000n },
      { accountId: 'acct-2', balance: 2500n },
      { accountId: 'acct-3', balance: 1500n },
    ];
    const { rootHash } = auditor.buildLiabilityTree(accounts);

    for (const a of accounts) {
      const inc = auditor.proveCustomerInclusion(a.accountId);
      expect(inc.liabilityRootHash).toBe(rootHash);
      expect(auditor.verifyCustomerInclusion(inc)).toBe(true);
    }

    const zeroEquity = auditor.generateSolvencyProof('exact-match', 5000n, 16);
    expect(auditor.verifySolvencyProof(zeroEquity)).toBe(true);

    // Tampered single bit proof must be caught
    const badBits = zeroEquity.equityBitProofs.map((bp, i) =>
      i === 0 ? { ...bp, s0: (bp.s0 + 1n) % SUBGROUP_Q } : bp,
    );
    expect(auditor.verifySolvencyProof({ ...zeroEquity, equityBitProofs: badBits })).toBe(false);

    // Error handling checks
    expect(() => auditor.proveCustomerInclusion('nonexistent')).toThrow();
    expect(() => auditor.buildLiabilityTree([])).toThrow();
    expect(() => auditor.buildLiabilityTree([{ accountId: 'neg', balance: -5n }])).toThrow();
    expect(() => auditor.generateSolvencyProof('overflow', 100000n, 8)).toThrow();
  });
});
