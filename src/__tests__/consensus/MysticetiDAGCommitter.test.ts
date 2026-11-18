import { MysticetiDAGCommitter } from '../../core/consensus/MysticetiDAGCommitter';

describe('MysticetiDAGCommitter', () => {
  it('commits leader block in 3 rounds and linearizes causal DAG history deterministically', () => {
    const validators = ['v1', 'v2', 'v3', 'v4'];
    const dag = new MysticetiDAGCommitter(validators);

    const r0 = validators.map((v) => dag.createBlock(0, v, [], `genesis-${v}`));
    r0.forEach((b) => expect(dag.insertBlock(b).accepted).toBe(true));

    const r0Digests = r0.map((b) => b.blockDigest);
    const r1 = validators.map((v) => dag.createBlock(1, v, r0Digests, `r1-${v}`));
    r1.forEach((b) => expect(dag.insertBlock(b).accepted).toBe(true));

    const r1Digests = r1.map((b) => b.blockDigest);
    const r2 = validators.map((v) => dag.createBlock(2, v, r1Digests, `r2-${v}`));
    r2.forEach((b) => expect(dag.insertBlock(b).accepted).toBe(true));

    const decision = dag.evaluateLeaderDecision(0);
    expect(decision.decision).toBe('commit');
    expect(decision.certificateCount).toBe(4);

    const committed = dag.commitLeaderHistory(0);
    expect(committed).not.toBeNull();
    expect(committed!.orderedBlocks).toHaveLength(1);
    expect(committed!.orderedBlocks[0].authorId).toBe('v1');
  });

  it('detects equivocation and rejects forged digests or under-quorum parents', () => {
    const dag = new MysticetiDAGCommitter(['v1', 'v2', 'v3', 'v4']);
    const b0 = dag.createBlock(0, 'v1', [], 'payload-a');
    const b0Conflict = dag.createBlock(0, 'v1', [], 'payload-b');

    expect(dag.insertBlock(b0).accepted).toBe(true);
    expect(dag.insertBlock(b0Conflict).accepted).toBe(false);
    expect(dag.getEquivocations()).toHaveLength(1);

    const forged = { ...dag.createBlock(0, 'v2', [], 'ok'), blockDigest: '0'.repeat(64) };
    expect(dag.insertBlock(forged).accepted).toBe(false);

    const underQuorum = dag.createBlock(1, 'v2', [b0.blockDigest], 'too-few');
    expect(dag.insertBlock(underQuorum).accepted).toBe(false);
  });
});
