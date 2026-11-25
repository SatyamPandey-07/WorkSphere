import { describe, it, expect } from 'vitest';
import { ZeroKnowledgeSecretShareVerification } from '../../core/zkp/ZeroKnowledgeSecretShareVerification';

describe('ZeroKnowledgeSecretShareVerification', () => {
  const hvss = new ZeroKnowledgeSecretShareVerification();

  it('enforces compartmented 2-of-3 department and inner-officer thresholds with fault tolerance', () => {
    const masterSecret = 777888999111n;
    const deal = hvss.dealHierarchicalSecret('enterprise-vault-2026', masterSecret, 2, [
      { departmentId: 'security', departmentSlotId: 1, innerThreshold: 2, officerIds: [1, 2, 3] },
      { departmentId: 'finance', departmentSlotId: 2, innerThreshold: 2, officerIds: [1, 2, 3] },
      { departmentId: 'legal', departmentSlotId: 3, innerThreshold: 2, officerIds: [1, 2, 3] },
    ]);

    expect(hvss.auditFullDeal(deal).allValid).toBe(true);

    // Submit security (with 1 corrupted officer filtered out) + legal (2 honest officers) -> recovers masterSecret!
    const secDept = deal.departments[0];
    const legalDept = deal.departments[2];
    const corruptedOfficer = { ...secDept.officerShares[1], secretShare: secDept.officerShares[1].secretShare + 5n };

    const submitted = new Map([
      ['security', [secDept.officerShares[0], corruptedOfficer, secDept.officerShares[2]]],
      ['legal', [legalDept.officerShares[0], legalDept.officerShares[2]]],
    ]);

    const recovery = hvss.recoverMasterSecret(deal, submitted);
    expect(recovery.verifiedAgainstMasterCommit).toBe(true);
    expect(recovery.recoveredSecret).toBe(masterSecret);
    expect(recovery.rejectedOfficers).toEqual([{ departmentId: 'security', officerId: 2 }]);

    // Only 1 department qualifying must fail outer quorum
    const singleDept = new Map([['legal', [legalDept.officerShares[0], legalDept.officerShares[1]]]]);
    expect(() => hvss.recoverMasterSecret(deal, singleDept)).toThrow();

    const pubJson = JSON.parse(hvss.serializePublicPolicy(deal)) as { policyId: string; outerThreshold: number };
    expect(pubJson.policyId).toBe('enterprise-vault-2026');
    expect(pubJson.outerThreshold).toBe(2);
  });
});
