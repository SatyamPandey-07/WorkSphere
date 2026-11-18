import {
  PipelineStateMachineReplication,
  SMRCommand,
} from '../../core/consensus/PipelineStateMachineReplication';

describe('PipelineStateMachineReplication', () => {
  const cluster = ['node-1', 'node-2', 'node-3', 'node-4'];
  const initialState = { balance: 100, counter: 0 };

  it('initializes cluster topology and assigns correct leader', () => {
    const smr = new PipelineStateMachineReplication({
      nodeId: 'node-1',
      clusterNodes: cluster,
      maxPipelineDepth: 5,
    }, initialState);

    expect(smr.clusterNodes.size).toBe(4);
    expect(smr.quorumSize).toBe(3); // 2f+1 for 4 nodes is 3
    expect(smr.getCurrentView()).toBe(0);
    expect(smr.getHighestCommittedSeq()).toBe(0);
    expect(smr.getState().balance).toBe(100);
  });

  it('proposes blocks and forms quorum certificates with pipelined commits', () => {
    // Sorted nodes: ['node-1', 'node-2', 'node-3', 'node-4']. View 0 leader is node-1.
    const leader = new PipelineStateMachineReplication({
      nodeId: 'node-1',
      clusterNodes: cluster,
    }, initialState);

    leader.registerExecutionHook((cmd, state) => {
      if (cmd.type === 'INCREMENT') {
        state.counter = (state.counter as number) + 1;
      }
    });

    const cmd1: SMRCommand = {
      id: 'cmd-1',
      type: 'INCREMENT',
      payload: {},
      clientId: 'client-1',
      timestamp: Date.now(),
    };

    // Propose block 1
    const block1 = leader.proposeBlock([cmd1]);
    expect(block1.seq).toBe(1);

    // Node 1, 2, 3 vote
    const vote1 = leader.receiveBlock(block1);
    const vote2 = { ...vote1, nodeId: 'node-2', signature: 'sig-2' };
    const vote3 = { ...vote1, nodeId: 'node-3', signature: 'sig-3' };

    leader.recordVote(vote2);
    const qc1 = leader.recordVote(vote3);
    expect(qc1).not.toBeNull();
    expect(qc1?.seq).toBe(1);

    // Propose block 2 with justifying QC1
    const cmd2: SMRCommand = {
      id: 'cmd-2',
      type: 'INCREMENT',
      payload: {},
      clientId: 'client-1',
      timestamp: Date.now(),
    };
    const block2 = leader.proposeBlock([cmd2], qc1);
    expect(block2.seq).toBe(2);

    // Quorum for block 2 triggers pipelined commit of block 1
    const v2_1 = leader.receiveBlock(block2);
    const v2_2 = { ...v2_1, nodeId: 'node-2', signature: 'sig-b2-2' };
    const v2_3 = { ...v2_1, nodeId: 'node-3', signature: 'sig-b2-3' };

    leader.recordVote(v2_2);
    const qc2 = leader.recordVote(v2_3);
    expect(qc2).not.toBeNull();

    // After QC on block 2, block 1 is committed!
    expect(leader.getHighestCommittedSeq()).toBe(1);
    expect(leader.getState().counter).toBe(1);
  });

  it('rejects blocks proposed by non-leaders', () => {
    const replica = new PipelineStateMachineReplication({
      nodeId: 'node-2',
      clusterNodes: cluster,
    }, initialState);

    const forgedBlock = {
      view: 0,
      seq: 1,
      proposerId: 'node-3', // View 0 leader is node-1
      commands: [],
      parentBlockHash: 'GENESIS',
      justifyQC: null,
      speculativeStateHash: 'hash',
      blockHash: 'block-hash',
      timestamp: Date.now(),
    };

    expect(() => replica.receiveBlock(forgedBlock)).toThrow('Invalid block proposer node-3');
  });

  it('creates and restores snapshots with log compaction', () => {
    const smr = new PipelineStateMachineReplication({
      nodeId: 'node-1',
      clusterNodes: cluster,
    }, { items: [] as string[] });

    smr.registerExecutionHook((cmd, state) => {
      (state.items as string[]).push(cmd.payload as string);
    });

    const b1 = smr.proposeBlock([{ id: 'c1', type: 'ADD', payload: 'alpha', clientId: 'c', timestamp: 1 }]);
    smr.commitBlock(b1.blockHash);

    const snapshot = smr.createSnapshot();
    expect(snapshot.lastIncludedSeq).toBe(1);
    expect(snapshot.state.items).toEqual(['alpha']);

    // Restore into fresh replica
    const freshReplica = new PipelineStateMachineReplication({
      nodeId: 'node-2',
      clusterNodes: cluster,
    }, { items: [] as string[] });

    const restored = freshReplica.restoreFromSnapshot(snapshot);
    expect(restored).toBe(true);
    expect(freshReplica.getHighestCommittedSeq()).toBe(1);
    expect(freshReplica.getState().items).toEqual(['alpha']);
  });
});
