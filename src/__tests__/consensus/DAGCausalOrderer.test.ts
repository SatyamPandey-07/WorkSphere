import { describe, it, expect } from 'vitest';
import { DAGCausalOrderer } from '../../core/consensus/DAGCausalOrderer';

describe('DAGCausalOrderer', () => {
  const validators = ['v1', 'v2', 'v3', 'v4']; // n=4, f=1, quorum=3

  it('produces identical deterministic total orders across replicas with reversed vertex arrival orders', () => {
    const replicaA = new DAGCausalOrderer(validators);
    const replicaB = new DAGCausalOrderer(validators);

    // Round 1 vertices
    const r1 = validators.map((v) => replicaA.createVertex(v, 1, `r1_${v}`, []));
    // Insert in forward order on A, reverse order on B
    for (const v of r1) expect(replicaA.insertVertex(v).accepted).toBe(true);
    for (const v of [...r1].reverse()) expect(replicaB.insertVertex(v).accepted).toBe(true);

    // Round 2 vertices referencing 3 parents from Round 1
    const r1Digests = r1.map((v) => v.digest);
    const r2 = [
      replicaA.createVertex('v1', 2, 'r2_v1', r1Digests.slice(0, 3)),
      replicaA.createVertex('v2', 2, 'r2_v2', r1Digests.slice(1, 4)),
      replicaA.createVertex('v3', 2, 'r2_v3', [r1Digests[0], r1Digests[2], r1Digests[3]]),
    ];
    for (const v of r2) expect(replicaA.insertVertex(v).accepted).toBe(true);
    for (const v of [...r2].reverse()) expect(replicaB.insertVertex(v).accepted).toBe(true);

    // Round 3 anchor vertex referencing all 3 Round 2 vertices
    const anchor = replicaA.createVertex('v1', 3, 'r3_anchor', r2.map((v) => v.digest));
    expect(replicaA.insertVertex(anchor).accepted).toBe(true);
    expect(replicaB.insertVertex(anchor).accepted).toBe(true);

    const outA = replicaA.commitAnchor(anchor.digest);
    const outB = replicaB.commitAnchor(anchor.digest);

    expect(outA.totalCommittedCount).toBe(8); // 4 (r1) + 3 (r2) + 1 (r3)
    const report = DAGCausalOrderer.verifyTotalOrderConsistency(
      replicaA.getCommittedLog(),
      replicaB.getCommittedLog()
    );
    expect(report.isConsistent).toBe(true);
    expect(report.causalOrderPreserved).toBe(true);
  });

  it('rejects vertices with insufficient parent quorum or same-round equivocation', () => {
    const orderer = new DAGCausalOrderer(validators);
    const v1a = orderer.createVertex('v1', 1, 'tx_a', []);
    const v1b = orderer.createVertex('v1', 1, 'tx_b', []);

    expect(orderer.insertVertex(v1a).accepted).toBe(true);
    // Equivocation in round 1 by v1
    const eqRes = orderer.insertVertex(v1b);
    expect(eqRes.accepted).toBe(false);
    expect(eqRes.reason).toContain('Equivocation');

    // Insufficient parents (only 1 parent < quorum 3) in round 2
    const badR2 = orderer.createVertex('v2', 2, 'bad_r2', [v1a.digest]);
    const qRes = orderer.insertVertex(badR2);
    expect(qRes.accepted).toBe(false);
    expect(qRes.reason).toContain('Insufficient parent references');
  });
});
