import { describe, it, expect } from 'vitest';
import { ZeroKnowledgePedersenThresholdAudit } from '../../core/zkp/ZeroKnowledgePedersenThresholdAudit';

describe('ZeroKnowledgePedersenThresholdAudit', () => {
  const audit = new ZeroKnowledgePedersenThresholdAudit();

  it('commits sensitive values under (3, 5) threshold blinding and verifies honest quorum openings', () => {
    const comm = audit.createThresholdCommitment('audit-2026-q4', 42500n, 3, [1, 2, 3, 4, 5]);
    for (const sh of comm.shares) {
      expect(audit.verifyAuditorShare(sh, comm.blindingPolynomialCommits)).toBe(true);
    }

    const p1 = audit.producePartialOpening(comm.auditId, comm.shares[0]);
    const p2Bad = { ...audit.producePartialOpening(comm.auditId, comm.shares[1]), response: 999n };
    const p3 = audit.producePartialOpening(comm.auditId, comm.shares[2]);
    const p5 = audit.producePartialOpening(comm.auditId, comm.shares[4]);

    const res = audit.combineAndVerifyAuditOpening(comm, 42500n, [p1, p2Bad, p3, p5]);
    expect(res.valid).toBe(true);
    expect(res.faultyAuditors).toEqual([2]);
    expect(res.proof?.participatingAuditors).toEqual([1, 3, 5]);

    // Wrong claimed value must fail verification
    expect(audit.combineAndVerifyAuditOpening(comm, 42501n, [p1, p3, p5]).valid).toBe(false);

    const json = JSON.parse(audit.serializeOpeningProof(res.proof!)) as { auditId: string; claimedValue: string };
    expect(json.auditId).toBe('audit-2026-q4');
    expect(json.claimedValue).toBe('42500');
  });
});
