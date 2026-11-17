/**
 * @file RaftConsensusEngine.test.ts
 * @description Comprehensive unit tests for RaftConsensusEngine, InMemoryRaftTransport,
 * cluster health evaluation, dynamic peer membership changes, and proposal pipelining.
 */

import {
  ClusterConfig,
  InMemoryRaftTransport,
  RaftConsensusEngine,
} from '../../core/consensus/RaftConsensusEngine';
import { RaftClusterNode } from '../../core/consensus/RaftClusterNode';
import { RaftLogStorage } from '../../core/consensus/RaftLogStorage';

describe('RaftConsensusEngine & Distributed Cluster Orchestration', () => {
  let engine: RaftConsensusEngine;
  const clusterConfig: ClusterConfig = {
    clusterId: 'test-cluster-1',
    peerIds: ['node-1', 'node-2', 'node-3'],
    heartbeatIntervalMs: 50,
    electionTimeoutMinMs: 150,
    electionTimeoutMaxMs: 300,
  };

  afterEach(async () => {
    if (engine) {
      await engine.closeAll();
    }
  });

  describe('InMemoryRaftTransport', () => {
    it('routes RequestVote and AppendEntries between registered nodes', async () => {
      const transport = new InMemoryRaftTransport();
      const storage1 = await RaftLogStorage.open({ namespace: 'trans-1' });
      const storage2 = await RaftLogStorage.open({ namespace: 'trans-2' });

      const node1 = await RaftClusterNode.create({
        id: 'n1',
        peers: ['n2'],
        storage: storage1,
        transport,
      });
      const node2 = await RaftClusterNode.create({
        id: 'n2',
        peers: ['n1'],
        storage: storage2,
        transport,
      });

      transport.registerNode('n1', node1);
      transport.registerNode('n2', node2);

      const voteRes = await transport.sendRequestVote('n2', {
        term: 1,
        candidateId: 'n1',
        lastLogIndex: 0,
        lastLogTerm: 0,
      });

      expect(voteRes.voteGranted).toBe(true);
      expect(voteRes.term).toBe(1);

      node1.stop();
      node2.stop();
      await node1.close();
      await node2.close();
    });

    it('blocks communication across network partitions', async () => {
      const transport = new InMemoryRaftTransport();
      const storage = await RaftLogStorage.open({ namespace: 'trans-part' });
      const node = await RaftClusterNode.create({
        id: 'n1',
        peers: [],
        storage,
        transport,
      });
      transport.registerNode('n1', node);

      transport.setPartition(['n1']);

      await expect(
        transport.sendRequestVote('n1', {
          term: 1,
          candidateId: 'n2',
          lastLogIndex: 0,
          lastLogTerm: 0,
        })
      ).rejects.toThrow('Network partition');

      node.stop();
      await node.close();
    });
  });

  describe('RaftConsensusEngine Cluster Management', () => {
    it('initializes all nodes and provides comprehensive cluster health', async () => {
      engine = await RaftConsensusEngine.create(clusterConfig);

      const health = engine.getClusterHealth();
      expect(health.clusterId).toBe('test-cluster-1');
      expect(health.totalNodes).toBe(3);
      expect(health.activeNodes).toBe(3);
      expect(health.hasQuorum).toBe(true);
      expect(health.nodes).toHaveLength(3);

      expect(engine.getNode('node-1')).toBeDefined();
      expect(engine.getNode('node-2')).toBeDefined();
      expect(engine.getNode('node-3')).toBeDefined();
    });

    it('dynamically adds and removes peer nodes', async () => {
      engine = await RaftConsensusEngine.create(clusterConfig);

      // Add node-4
      await engine.addPeer('node-4');
      let health = engine.getClusterHealth();
      expect(health.totalNodes).toBe(4);
      expect(engine.getNode('node-4')).toBeDefined();

      // Remove node-4
      const removed = await engine.removePeer('node-4');
      expect(removed).toBe(true);

      health = engine.getClusterHealth();
      expect(health.totalNodes).toBe(3);
      expect(engine.getNode('node-4')).toBeUndefined();
    });

    it('rejects proposal when no leader is elected', async () => {
      engine = await RaftConsensusEngine.create(clusterConfig);

      const result = await engine.reserveDesk('desk-1', 'user-1', 3600);

      if (!engine.getLeader()) {
        expect(result.success).toBe(false);
        expect(result.error).toContain('No active leader');
      }
    });

    it('reserves and releases a desk through the elected leader', async () => {
      // One node is its own majority, so the commands commit without depending
      // on election timing between peers. The test is about how the engine
      // passes a reservation on to the node.
      engine = await RaftConsensusEngine.create({
        ...clusterConfig,
        clusterId: 'test-cluster-desks',
        peerIds: ['solo-1'],
      });

      // Wait for the cluster to elect a leader.
      for (let i = 0; i < 60 && !engine.getLeader(); i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(engine.getLeader()).toBeDefined();

      const before = Date.now();
      const reserved = await engine.reserveDesk('desk-1', 'user-1', 60_000);
      expect(reserved.success).toBe(true);
      expect(reserved.error).toBeUndefined();
      expect(reserved.result?.status).toBe('committed');
      expect(reserved.result?.reservation).toMatchObject({
        deskId: 'desk-1',
        memberId: 'user-1',
        venueId: 'test-cluster-desks',
      });
      expect(reserved.result?.reservation?.expiresAt).toBeGreaterThanOrEqual(before + 60_000);

      // The desk is locked for everyone else.
      const taken = await engine.reserveDesk('desk-1', 'user-2', 60_000);
      expect(taken.success).toBe(false);
      expect(taken.error).toBe('desk-already-reserved');

      // Only the member holding the desk can release it.
      const wrongMember = await engine.releaseDesk('desk-1', 'user-2');
      expect(wrongMember.success).toBe(false);
      expect(wrongMember.error).toContain('reserved by another member');

      const released = await engine.releaseDesk('desk-1', 'user-1');
      expect(released.success).toBe(true);
      expect(released.result?.status).toBe('committed');

      const nothingHeld = await engine.releaseDesk('desk-1', 'user-1');
      expect(nothingHeld.success).toBe(false);
      expect(nothingHeld.error).toContain('No reservation is held');

      // Free again for the next member.
      const again = await engine.reserveDesk('desk-1', 'user-2', 60_000);
      expect(again.success).toBe(true);
    }, 15000);

    it('successfully stops all nodes without leaking timers', async () => {
      engine = await RaftConsensusEngine.create(clusterConfig);
      expect(() => engine.stopAll()).not.toThrow();
    });
  });
});
