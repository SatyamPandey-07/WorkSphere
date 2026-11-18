import {
  RaftClusterNode,
  type AppendEntriesRequest,
  type AppendEntriesResponse,
  type RaftTransport,
  type RequestVoteRequest,
  type RequestVoteResponse,
} from "@/core/consensus/RaftClusterNode";
import { RaftLogStorage } from "@/core/consensus/RaftLogStorage";

class InMemoryRaftNetwork implements RaftTransport {
  private readonly nodes = new Map<string, RaftClusterNode>();
  private readonly blockedLinks = new Set<string>();

  public register(node: RaftClusterNode): void {
    this.nodes.set(node.id, node);
  }

  public isolate(nodeId: string): void {
    for (const peerId of this.nodes.keys()) {
      if (peerId !== nodeId) {
        this.blockedLinks.add(this.linkKey(nodeId, peerId));
      }
    }
  }

  public heal(): void {
    this.blockedLinks.clear();
  }

  public async sendRequestVote(
    peerId: string,
    request: RequestVoteRequest,
  ): Promise<RequestVoteResponse> {
    this.assertReachable(request.candidateId, peerId);
    const peer = this.requirePeer(peerId);
    return peer.handleRequestVote(request);
  }

  public async sendAppendEntries(
    peerId: string,
    request: AppendEntriesRequest,
  ): Promise<AppendEntriesResponse> {
    this.assertReachable(request.leaderId, peerId);
    const peer = this.requirePeer(peerId);
    return peer.handleAppendEntries(request);
  }

  private requirePeer(peerId: string): RaftClusterNode {
    const peer = this.nodes.get(peerId);
    if (!peer) {
      throw new Error(`Unknown raft peer ${peerId}`);
    }
    return peer;
  }

  private assertReachable(from: string, to: string): void {
    if (this.blockedLinks.has(this.linkKey(from, to))) {
      throw new Error(`Network partition between ${from} and ${to}`);
    }
  }

  private linkKey(left: string, right: string): string {
    return [left, right].sort().join("::");
  }
}

async function settle<T>(promise: Promise<T>, advanceMs = 60): Promise<T> {
  await jest.advanceTimersByTimeAsync(advanceMs);
  return promise;
}

describe("RaftClusterNode", () => {
  let network: InMemoryRaftNetwork;
  let nodes: RaftClusterNode[];

  beforeEach(() => {
    jest.useFakeTimers();
    network = new InMemoryRaftNetwork();
    nodes = [];
  });

  afterEach(async () => {
    for (const node of nodes) {
      await node.close().catch(() => undefined);
    }
    jest.useRealTimers();
  });

  async function createCluster(
    size: number,
    options: { proposalTimeoutMs?: number; random?: number[] } = {},
  ): Promise<RaftClusterNode[]> {
    const ids = Array.from(
      { length: size },
      (_, index) => `node-${String.fromCharCode(97 + index)}`,
    );
    const randoms =
      options.random ?? ids.map((_, index) => index / Math.max(1, size));

    const created: RaftClusterNode[] = [];

    for (let index = 0; index < ids.length; index += 1) {
      const node = await RaftClusterNode.create({
        id: ids[index],
        peers: ids.filter((id) => id !== ids[index]),
        transport: network,
        storage: await RaftLogStorage.open({ backend: "memory" }),
        electionTimeoutMinMs: 150,
        electionTimeoutMaxMs: 300,
        heartbeatIntervalMs: 40,
        proposalTimeoutMs: options.proposalTimeoutMs ?? 300,
        random: () => randoms[index],
      });

      network.register(node);
      created.push(node);
    }

    nodes.push(...created);
    return created;
  }

  it("elects exactly one leader and keeps followers stable through heartbeats", async () => {
    const cluster = await createCluster(3);

    await jest.advanceTimersByTimeAsync(160);

    const leaders = cluster.filter((node) => node.isLeader());
    expect(leaders).toHaveLength(1);
    expect(leaders[0].id).toBe("node-a");
    expect(leaders[0].getCurrentTerm()).toBe(1);

    for (const follower of cluster.filter((node) => node !== leaders[0])) {
      expect(follower.getRole()).toBe("follower");
      expect(follower.getLeaderId()).toBe("node-a");
    }

    await jest.advanceTimersByTimeAsync(400);

    expect(cluster.filter((node) => node.isLeader())).toHaveLength(1);
    expect(leaders[0].getCurrentTerm()).toBe(1);
  });

  it("commits a reservation lock only after majority replication and applies it everywhere", async () => {
    const cluster = await createCluster(3);
    await jest.advanceTimersByTimeAsync(160);

    const leader = cluster[0];
    const result = await settle(
      leader.reserveDesk({
        reservationId: "res-1",
        deskId: "desk-1",
        venueId: "venue-1",
        memberId: "member-1",
        expiresAt: 1_000,
      }),
    );

    expect(result.status).toBe("committed");
    expect(result.reservation?.reservationId).toBe("res-1");
    expect(result.reservation?.deskId).toBe("desk-1");

    await jest.advanceTimersByTimeAsync(80);

    for (const node of cluster) {
      expect(node.getDeskReservation("desk-1")?.reservationId).toBe("res-1");
    }

    expect(cluster[1].getLog()).toEqual(cluster[0].getLog());
    expect(cluster[2].getLog()).toEqual(cluster[0].getLog());
  });

  it("rejects a second reservation for an already locked desk without diverging", async () => {
    const cluster = await createCluster(3);
    await jest.advanceTimersByTimeAsync(160);

    const leader = cluster[0];

    const first = await settle(
      leader.reserveDesk({
        reservationId: "res-1",
        deskId: "desk-1",
        venueId: "venue-1",
        memberId: "member-1",
        expiresAt: 1_000,
      }),
    );
    const second = await settle(
      leader.reserveDesk({
        reservationId: "res-2",
        deskId: "desk-1",
        venueId: "venue-1",
        memberId: "member-2",
        expiresAt: 2_000,
      }),
    );

    expect(first.status).toBe("committed");
    expect(second.status).toBe("rejected");
    expect(second.reason).toBe("desk-already-reserved");
    expect(second.heldBy).toBe("res-1");
    expect(leader.getDeskReservation("desk-1")?.reservationId).toBe("res-1");
  });

  it("blocks minority commits and elects a new leader after a partition heals", async () => {
    const cluster = await createCluster(3, { proposalTimeoutMs: 250 });
    await jest.advanceTimersByTimeAsync(160);

    const oldLeader = cluster[0];
    expect(oldLeader.isLeader()).toBe(true);

    network.isolate(oldLeader.id);

    const minorityProposal = oldLeader.reserveDesk({
      reservationId: "res-minority",
      deskId: "desk-1",
      venueId: "venue-1",
      memberId: "member-1",
      expiresAt: 1_000,
    });
    const minorityRejection = expect(minorityProposal).rejects.toThrow(
      /not committed by a majority quorum/,
    );

    await jest.advanceTimersByTimeAsync(250);
    await minorityRejection;
    expect(oldLeader.getCommitIndex()).toBe(0);

    await jest.advanceTimersByTimeAsync(300);

    const newLeader = cluster.find(
      (node) => node !== oldLeader && node.isLeader(),
    );
    if (!newLeader) {
      throw new Error("Expected the majority partition to elect a new leader");
    }

    expect(newLeader.getCurrentTerm()).toBeGreaterThan(
      oldLeader.getCurrentTerm(),
    );

    const majorityResult = await settle(
      newLeader.reserveDesk({
        reservationId: "res-majority",
        deskId: "desk-2",
        venueId: "venue-1",
        memberId: "member-2",
        expiresAt: 2_000,
      }),
    );

    expect(majorityResult.status).toBe("committed");

    network.heal();
    await jest.advanceTimersByTimeAsync(120);

    expect(oldLeader.getRole()).toBe("follower");
    expect(oldLeader.getLeaderId()).toBe(newLeader.id);
    expect(oldLeader.getLog()).toEqual(newLeader.getLog());
    expect(oldLeader.getDeskReservation("desk-2")?.reservationId).toBe(
      "res-majority",
    );
  });

  it("restores persisted term, vote and log state after a restart", async () => {
    const storage = await RaftLogStorage.open({ backend: "memory" });
    const singleNodeNetwork = new InMemoryRaftNetwork();

    const first = await RaftClusterNode.create({
      id: "node-a",
      peers: [],
      transport: singleNodeNetwork,
      storage,
      electionTimeoutMinMs: 150,
      electionTimeoutMaxMs: 150,
      heartbeatIntervalMs: 40,
      proposalTimeoutMs: 300,
      random: () => 0,
    });
    nodes.push(first);
    singleNodeNetwork.register(first);

    await jest.advanceTimersByTimeAsync(160);
    expect(first.isLeader()).toBe(true);

    const committed = await settle(
      first.reserveDesk({
        reservationId: "res-1",
        deskId: "desk-1",
        venueId: "venue-1",
        memberId: "member-1",
        expiresAt: 1_000,
      }),
    );
    expect(committed.status).toBe("committed");

    const persistedTerm = first.getCurrentTerm();
    const persistedLog = first.getLog();
    first.stop();

    const restored = await RaftClusterNode.create({
      id: "node-a",
      peers: [],
      transport: singleNodeNetwork,
      storage,
      electionTimeoutMinMs: 150,
      electionTimeoutMaxMs: 150,
      heartbeatIntervalMs: 40,
      proposalTimeoutMs: 300,
      random: () => 0,
    });
    nodes.push(restored);
    singleNodeNetwork.register(restored);

    expect(restored.getCurrentTerm()).toBe(persistedTerm);
    expect(restored.getLog()).toEqual(persistedLog);
  });

  it("persists term, vote and log entries to IndexedDB", async () => {
    jest.useRealTimers();

    const dbName = `worksphere-raft-test-${Date.now()}-${Math.floor(
      Math.random() * 1_000_000,
    )}`;
    const storage = await RaftLogStorage.open({
      backend: "indexeddb",
      dbName,
      namespace: "node-a",
    });

    expect(storage.kind).toBe("indexeddb");

    await storage.saveMeta({ currentTerm: 4, votedFor: "node-b" });
    await storage.appendEntry({
      index: 1,
      term: 4,
      command: { type: "NOOP" },
      timestamp: 10,
    });
    await storage.appendEntry({
      index: 2,
      term: 4,
      command: { type: "NOOP" },
      timestamp: 20,
    });
    await storage.close();

    const reopened = await RaftLogStorage.open({
      backend: "indexeddb",
      dbName,
      namespace: "node-a",
    });
    const loaded = await reopened.load();

    expect(loaded.currentTerm).toBe(4);
    expect(loaded.votedFor).toBe("node-b");
    expect(loaded.log.map((entry) => entry.index)).toEqual([1, 2]);

    await reopened.truncateFrom(2);
    const truncated = await reopened.load();
    expect(truncated.log.map((entry) => entry.index)).toEqual([1]);

    await reopened.close();
  });
});
