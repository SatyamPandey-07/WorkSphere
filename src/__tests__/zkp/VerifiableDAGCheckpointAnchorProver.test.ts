import { describe, it, expect } from 'vitest';
import { VerifiableDAGCheckpointAnchorProver, SUBGROUP_Q } from '../../core/zkp/VerifiableDAGCheckpointAnchorProver';

describe('VerifiableDAGCheckpointAnchorProver', () => {
  it('builds a multi-round quorum DAG, certifies causal checkpoint anchors, and enforces topological ordering', () => {
    const dag = new VerifiableDAGCheckpointAnchorProver('bullshark-mainnet');
    const v1 = dag.registerValidator('val-1');
    const v2 = dag.registerValidator('val-2');
    const v3 = dag.registerValidator('val-3');
    const v4 = dag.registerValidator('val-4');
    // Quorum of 4 = floor(8/3) + 1 = 3
    expect(dag.getQuorumSize()).toBe(3);

    // Round 0 genesis vertices
    const r0 = [v1, v2, v3, v4].map((v, i) => dag.createVertex(v, 0, `gen-${i}`, []));
    for (const vert of r0) expect(dag.verifyAndInsertVertex(vert)).toEqual({ accepted: true });

    // Round 1 vertices referencing 3 parents from Round 0
    const r0Digests = r0.slice(0, 3).map((x) => x.digest);
    const r1 = [v1, v2, v3].map((v, i) => dag.createVertex(v, 1, `r1-tx-${i}`, r0Digests));
    for (const vert of r1) expect(dag.verifyAndInsertVertex(vert)).toEqual({ accepted: true });

    // Round 2 anchor referencing all 3 Round 1 vertices
    const anchor = dag.createVertex(v1, 2, 'r2-anchor', r1.map((x) => x.digest));
    expect(dag.verifyAndInsertVertex(anchor)).toEqual({ accepted: true });

    const cp = dag.createCheckpointAnchor(anchor.digest, [v1, v2, v3]);
    expect(cp.orderedHistoryDigests.length).toBe(7); // 3 r0 + 3 r1 + 1 r2
    expect(dag.verifyCheckpointAnchor(cp)).toBe(true);

    // Reversing causal history breaks topological parent ordering check
    expect(dag.verifyCheckpointAnchor({ ...cp, orderedHistoryDigests: [...cp.orderedHistoryDigests].reverse() })).toBe(false);

    const json = JSON.parse(dag.serializeCheckpoint(cp)) as { anchorRound: number; historyCount: number };
    expect(json.anchorRound).toBe(2);
    expect(json.historyCount).toBe(7);
  });

  it('rejects insufficient parent quorums, forged signatures, and tampered checkpoints', () => {
    const dag = new VerifiableDAGCheckpointAnchorProver('strict-dag');
    const v1 = dag.registerValidator('a');
    const v2 = dag.registerValidator('b');
    const v3 = dag.registerValidator('c');
    const v4 = dag.registerValidator('d');

    expect(() => dag.registerValidator('a')).toThrow();

    const g1 = dag.createVertex(v1, 0, 'g1', []);
    const g2 = dag.createVertex(v2, 0, 'g2', []);
    const g3 = dag.createVertex(v3, 0, 'g3', []);
    expect(dag.verifyAndInsertVertex(g1).accepted).toBe(true);
    expect(dag.verifyAndInsertVertex(g2).accepted).toBe(true);
    expect(dag.verifyAndInsertVertex(g3).accepted).toBe(true);

    // Forged signature rejected
    expect(dag.verifyAndInsertVertex({ ...g1, sigS: (g1.sigS + 1n) % SUBGROUP_Q }).accepted).toBe(false);
    // Round 0 with parents rejected
    expect(dag.verifyAndInsertVertex(dag.createVertex(v4, 0, 'bad-gen', [g1.digest])).accepted).toBe(false);
    // Round 1 with only 2 parents (< quorum 3) rejected
    expect(dag.verifyAndInsertVertex(dag.createVertex(v1, 1, 'too-few', [g1.digest, g2.digest])).accepted).toBe(false);

    const r1 = dag.createVertex(v1, 1, 'ok-r1', [g1.digest, g2.digest, g3.digest]);
    expect(dag.verifyAndInsertVertex(r1).accepted).toBe(true);

    expect(() => dag.createCheckpointAnchor(r1.digest, [v1, v2])).toThrow();
    const cp = dag.createCheckpointAnchor(r1.digest, [v1, v2, v4]);
    expect(dag.verifyCheckpointAnchor(cp)).toBe(true);
    expect(dag.verifyCheckpointAnchor({ ...cp, historyMerkleRoot: '00'.repeat(32) })).toBe(false);
    expect(
      dag.verifyCheckpointAnchor({
        ...cp,
        endorsements: [{ ...cp.endorsements[0], sigS: (cp.endorsements[0].sigS + 1n) % SUBGROUP_Q }, ...cp.endorsements.slice(1)],
      }),
    ).toBe(false);
  });

  it('rejects missing parents, wrong parent rounds, unknown validators, and cross-DAG vertices', () => {
    const dag = new VerifiableDAGCheckpointAnchorProver('dag-edge');
    const v1 = dag.registerValidator('v1');
    const v2 = dag.registerValidator('v2');
    const v3 = dag.registerValidator('v3');
    const otherDag = new VerifiableDAGCheckpointAnchorProver('other-dag');
    const rogue = otherDag.registerValidator('rogue');

    const g1 = dag.createVertex(v1, 0, 'g1', []);
    const g2 = dag.createVertex(v2, 0, 'g2', []);
    const g3 = dag.createVertex(v3, 0, 'g3', []);
    expect(dag.verifyAndInsertVertex(g1).accepted).toBe(true);
    expect(dag.verifyAndInsertVertex(g2).accepted).toBe(true);
    expect(dag.verifyAndInsertVertex(g3).accepted).toBe(true);

    expect(dag.verifyAndInsertVertex(otherDag.createVertex(rogue, 0, 'x', [])).accepted).toBe(false);
    expect(dag.verifyAndInsertVertex(dag.createVertex(v1, 1, 'missing-parent', ['deadbeef', g1.digest, g2.digest])).accepted).toBe(false);

    const r1 = dag.createVertex(v1, 1, 'r1', [g1.digest, g2.digest, g3.digest]);
    expect(dag.verifyAndInsertVertex(r1).accepted).toBe(true);
    // Round 2 referencing round 0 vertex directly (wrong parent round)
    expect(dag.verifyAndInsertVertex(dag.createVertex(v2, 2, 'skip-round', [r1.digest, g1.digest, g2.digest])).accepted).toBe(false);
    expect(() => dag.computeCausalHistory('nonexistent')).toThrow();
  });
});
