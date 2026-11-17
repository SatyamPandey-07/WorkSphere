import { RaftNode } from '../../lib/consensus/raftNode';
import type { RaftNetwork, RequestVoteArgs, RequestVoteReply, AppendEntriesArgs, AppendEntriesReply, LogEntry } from '../../lib/consensus/types';

class SimulatedClusterNetwork implements RaftNetwork {
  private nodes: Map<string, RaftNode> = new Map();
  public partitionedNodes: Set<string> = new Set();

  /**
   * A partitioned node is cut off in both directions: it receives nothing and
   * nothing it sends arrives. Blocking only the messages sent to it would let a
   * partitioned leader keep sending heartbeats, so the others would never
   * start an election.
   */
  private isCutOff(targetId: string, senderId: string): boolean {
    return this.partitionedNodes.has(targetId) || this.partitionedNodes.has(senderId);
  }

  register(node: RaftNode) {
    this.nodes.set(node.id, node);
  }

  async sendRequestVote(targetId: string, args: RequestVoteArgs): Promise<RequestVoteReply> {
    if (this.isCutOff(targetId, args.candidateId)) throw new Error('Network partition');
    const target = this.nodes.get(targetId);
    if (!target) throw new Error('Node not found');
    return target.onRequestVote(args);
  }

  async sendAppendEntries(targetId: string, args: AppendEntriesArgs): Promise<AppendEntriesReply> {
    if (this.isCutOff(targetId, args.leaderId)) throw new Error('Network partition');
    const target = this.nodes.get(targetId);
    if (!target) throw new Error('Node not found');
    return target.onAppendEntries(args);
  }
}

describe('Raft Consensus State Machine & Leader Election (#7960)', () => {
  let network: SimulatedClusterNetwork;
  let node1: RaftNode;
  let node2: RaftNode;
  let node3: RaftNode;

  beforeEach(() => {
    network = new SimulatedClusterNetwork();
    node1 = new RaftNode('node1', ['node2', 'node3'], network);
    node2 = new RaftNode('node2', ['node1', 'node3'], network);
    node3 = new RaftNode('node3', ['node1', 'node2'], network);

    network.register(node1);
    network.register(node2);
    network.register(node3);
  });

  afterEach(() => {
    node1.stop();
    node2.stop();
    node3.stop();
  });

  test('Cluster of 3 nodes reliably elects a leader within 1 second', async () => {
    // Wait for random election timeouts to trigger leader election
    await new Promise((resolve) => setTimeout(resolve, 600));

    const states = [node1.state, node2.state, node3.state];
    const leaders = states.filter((s) => s === 'Leader');

    expect(leaders.length).toBe(1);
  });

  test('If the leader is partitioned, remaining nodes successfully elect a new leader', async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));

    // Find current leader
    const nodes = [node1, node2, node3];
    const currentLeader = nodes.find((n) => n.state === 'Leader');
    expect(currentLeader).toBeDefined();

    // Partition the leader
    network.partitionedNodes.add(currentLeader!.id);

    // Wait for next election cycle
    await new Promise((resolve) => setTimeout(resolve, 500));

    const remainingLeaders = nodes
      .filter((n) => n.id !== currentLeader!.id)
      .filter((n) => n.state === 'Leader');

    expect(remainingLeaders.length).toBe(1);
    expect(remainingLeaders[0].currentTerm).toBeGreaterThan(currentLeader!.currentTerm);
  });

  test('Leader accepts proposal, replicates to peers, reaches quorum, and applies to state machine', async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));

    const nodes = [node1, node2, node3];
    const leader = nodes.find((n) => n.state === 'Leader');
    expect(leader).toBeDefined();

    const appliedEntries: LogEntry[] = [];
    leader!.onApply((entry) => appliedEntries.push(entry));

    const result = await leader!.propose({ action: 'UPDATE_VENUE_CAPACITY', venueId: 'venue-101', capacity: 25 });
    expect(result.success).toBe(true);
    expect(result.index).toBe(1);

    // Wait for append entries cycle to replicate and advance commitIndex
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(leader!.commitIndex).toBe(1);
    expect(leader!.lastApplied).toBe(1);
    expect(appliedEntries.length).toBe(1);
    expect((appliedEntries[0].command as any).action).toBe('UPDATE_VENUE_CAPACITY');
  });

  test('Followers reject client proposals directly', async () => {
    await new Promise((resolve) => setTimeout(resolve, 600));

    const nodes = [node1, node2, node3];
    const follower = nodes.find((n) => n.state === 'Follower');
    expect(follower).toBeDefined();

    const result = await follower!.propose({ action: 'INVALID_WRITE' });
    expect(result.success).toBe(false);
  });
});
