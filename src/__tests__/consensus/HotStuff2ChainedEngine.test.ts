import { describe, it, expect } from 'vitest';
import {
  HotStuff2ChainedEngine,
  HotStuff2Replica,
} from '../../core/consensus/HotStuff2ChainedEngine';

describe('HotStuff2ChainedEngine', () => {
  const replicas: HotStuff2Replica[] = [
    { id: 'r1', publicKey: 'sec-1' },
    { id: 'r2', publicKey: 'sec-2' },
    { id: 'r3', publicKey: 'sec-3' },
    { id: 'r4', publicKey: 'sec-4' },
  ];
  // n = 4, f = 1, quorum = 3

  it('commits blocks in 2 consecutive views under HotStuff-2 direct commit rule', () => {
    const engine = new HotStuff2ChainedEngine(replicas);
    expect(engine.quorumSize).toBe(3);

    // View 1: Propose B1 extending genesis
    const b1 = engine.proposeBlock('r1', 1, 'TX_BATCH_1');
    for (const r of replicas.slice(0, 3)) {
      const vote = engine.voteBlock(r.id, r.publicKey, b1)!;
      expect(vote).not.toBeNull();
      engine.collectVote(vote);
    }

    expect(engine.getHighQC().blockHash).toBe(b1.hash);
    expect(engine.getCommittedChain().length).toBe(1); // Only genesis committed so far

    // View 2: Propose B2 extending B1's QC -> consecutive views (1 -> 2) triggers 2-chain commit of B1!
    const b2 = engine.proposeBlock('r2', 2, 'TX_BATCH_2');
    let lastRes: any = null;
    for (const r of replicas.slice(0, 3)) {
      const vote = engine.voteBlock(r.id, r.publicKey, b2)!;
      lastRes = engine.collectVote(vote);
    }

    expect(lastRes.qcFormed).not.toBeNull();
    expect(lastRes.commitResult.newlyCommitted.length).toBe(1);
    expect(lastRes.commitResult.newlyCommitted[0].hash).toBe(b1.hash);
    expect(engine.getCommittedChain().length).toBe(2); // Genesis + B1
  });

  it('enforces SafeNode rule rejecting conflicting forks below lockedQC view', () => {
    const engine = new HotStuff2ChainedEngine(replicas);

    // View 1: B1 receives QC
    const b1 = engine.proposeBlock('r1', 1, 'HONEST_1');
    for (const r of replicas.slice(0, 3)) {
      engine.collectVote(engine.voteBlock(r.id, r.publicKey, b1)!);
    }

    // View 2: B2 extends B1 -> replicas update lockedQC to B1 (view 1)
    const b2 = engine.proposeBlock('r2', 2, 'HONEST_2');
    engine.voteBlock('r1', 'sec-1', b2);
    expect(engine.getLockedQC().view).toBe(1);

    // Malicious fork at View 3 trying to justify from genesis (view 0 < lockedQC view 1)
    const genesisQC = engine.getCommittedChain()[0].justifyQC;
    const forkBlock = engine.proposeBlock('r4', 3, 'MALICIOUS_FORK', genesisQC);

    expect(engine.isSafeBlock(forkBlock)).toBe(false);
    expect(engine.voteBlock('r1', 'sec-1', forkBlock)).toBeNull();
  });

  it('advances view cleanly upon collecting 2f+1 timeout votes into a Timeout Certificate', () => {
    const engine = new HotStuff2ChainedEngine(replicas);
    expect(engine.getCurrentView()).toBe(1);

    engine.handleViewTimeout('r1', 'sec-1', 1);
    engine.handleViewTimeout('r2', 'sec-2', 1);
    const res3 = engine.handleViewTimeout('r3', 'sec-3', 1);

    expect(res3.tcFormed).not.toBeNull();
    expect(res3.tcFormed!.view).toBe(1);
    expect(engine.getCurrentView()).toBe(2);
  });
});
