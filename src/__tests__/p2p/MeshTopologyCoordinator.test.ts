/**
 * @file MeshTopologyCoordinator.test.ts
 * @description Comprehensive unit tests for WebRTC Mesh Topology Self-Healing Coordinator,
 * Tarjan's bridge finding, Dijkstra shortest-path routing, failure eviction, and partition recovery.
 */

import {
  MeshTopologyCoordinator,
  PeerNode,
} from '../../core/p2p/MeshTopologyCoordinator';

describe('MeshTopologyCoordinator & P2P Mesh Routing Suite', () => {
  const localId = 'node-local';

  it('initializes coordinator with local peer and degree configurations', () => {
    const coordinator = new MeshTopologyCoordinator({
      localPeerId: localId,
      minDegree: 2,
      targetDegree: 4,
      maxDegree: 6,
    });

    expect(coordinator.getLocalPeerId()).toBe(localId);
    expect(coordinator.getLocalDegree()).toBe(0);
    expect(coordinator.getPeer(localId)).toBeDefined();
    expect(coordinator.getPeer(localId)!.status).toBe('active');
  });

  it('manages peer nodes and bidirectional mesh links', () => {
    const coordinator = new MeshTopologyCoordinator({ localPeerId: localId });

    coordinator.addPeerNode({
      id: 'node-A',
      rttMs: 20,
      lastHeartbeat: Date.now(),
      connectedAt: Date.now(),
      status: 'active',
    });

    coordinator.addPeerNode({
      id: 'node-B',
      rttMs: 35,
      lastHeartbeat: Date.now(),
      connectedAt: Date.now(),
      status: 'active',
    });

    coordinator.addLink(localId, 'node-A', 20);
    coordinator.addLink('node-A', 'node-B', 15);

    expect(coordinator.getLocalDegree()).toBe(1);
    expect(coordinator.getNeighbors(localId)).toEqual(['node-A']);
    expect(coordinator.getNeighbors('node-A')).toContain(localId);
    expect(coordinator.getNeighbors('node-A')).toContain('node-B');

    coordinator.removeLink(localId, 'node-A');
    expect(coordinator.getLocalDegree()).toBe(0);
  });

  describe('Heartbeat & Failure Detection', () => {
    it('records heartbeat with smoothed RTT moving average', () => {
      const coordinator = new MeshTopologyCoordinator({ localPeerId: localId });

      coordinator.recordHeartbeat('node-A', 100);
      const peer = coordinator.getPeer('node-A');
      expect(peer).toBeDefined();
      expect(peer!.rttMs).toBe(100);

      // Second heartbeat with lower latency updates moving average (0.7 * 100 + 0.3 * 50 = 85)
      coordinator.recordHeartbeat('node-A', 50);
      expect(peer!.rttMs).toBe(85);
    });

    it('sweeps heartbeats and evicts peers exceeding timeout threshold', () => {
      const coordinator = new MeshTopologyCoordinator({
        localPeerId: localId,
        heartbeatTimeoutMs: 5000,
        degradedThresholdMs: 2000,
      });

      const now = Date.now();
      coordinator.addPeerNode({
        id: 'node-active',
        rttMs: 20,
        lastHeartbeat: now - 500, // Fresh
        connectedAt: now,
        status: 'active',
      });

      coordinator.addPeerNode({
        id: 'node-degraded',
        rttMs: 40,
        lastHeartbeat: now - 3000, // Degraded
        connectedAt: now,
        status: 'active',
      });

      coordinator.addPeerNode({
        id: 'node-dead',
        rttMs: 90,
        lastHeartbeat: now - 8000, // Exceeded timeout
        connectedAt: now,
        status: 'active',
      });

      const evicted = coordinator.sweepHeartbeats(now);

      expect(evicted).toContain('node-dead');
      expect(coordinator.getPeer('node-dead')).toBeUndefined();
      expect(coordinator.getPeer('node-degraded')!.status).toBe('degraded');
      expect(coordinator.getPeer('node-active')!.status).toBe('active');
    });
  });

  describe('Dijkstra Shortest-Path Latency Routing', () => {
    it('finds lowest-latency multi-hop path rather than high-latency direct link', () => {
      const coordinator = new MeshTopologyCoordinator({ localPeerId: localId });

      // Topology:
      // local -> node-C: 100ms (direct slow link)
      // local -> node-A: 10ms, node-A -> node-B: 15ms, node-B -> node-C: 10ms (3-hop fast link: 35ms total)
      coordinator.addPeerNode({ id: 'node-A', rttMs: 10, lastHeartbeat: Date.now(), connectedAt: Date.now(), status: 'active' });
      coordinator.addPeerNode({ id: 'node-B', rttMs: 15, lastHeartbeat: Date.now(), connectedAt: Date.now(), status: 'active' });
      coordinator.addPeerNode({ id: 'node-C', rttMs: 100, lastHeartbeat: Date.now(), connectedAt: Date.now(), status: 'active' });

      coordinator.addLink(localId, 'node-C', 100);
      coordinator.addLink(localId, 'node-A', 10);
      coordinator.addLink('node-A', 'node-B', 15);
      coordinator.addLink('node-B', 'node-C', 10);

      const result = coordinator.findShortestPath(localId, 'node-C');

      expect(result).not.toBeNull();
      expect(result!.path).toEqual([localId, 'node-A', 'node-B', 'node-C']);
      expect(result!.totalLatencyMs).toBe(35);
      expect(result!.hopCount).toBe(3);
    });

    it('returns null when target node is unreachable across partitioned graph', () => {
      const coordinator = new MeshTopologyCoordinator({ localPeerId: localId });

      coordinator.addPeerNode({ id: 'node-isolated', rttMs: 50, lastHeartbeat: Date.now(), connectedAt: Date.now(), status: 'active' });

      const result = coordinator.findShortestPath(localId, 'node-isolated');
      expect(result).toBeNull();
    });
  });

  describe('Tarjan Bridge Detection & Graph Health', () => {
    it('accurately identifies bridge links whose failure disconnects graph', () => {
      const coordinator = new MeshTopologyCoordinator({ localPeerId: localId });

      // Topology: (local - A - local cycle) connected to (B - C - B cycle) via single bridge edge (A - B)
      coordinator.addPeerNode({ id: 'node-A', rttMs: 10, lastHeartbeat: Date.now(), connectedAt: Date.now(), status: 'active' });
      coordinator.addPeerNode({ id: 'node-B', rttMs: 10, lastHeartbeat: Date.now(), connectedAt: Date.now(), status: 'active' });
      coordinator.addPeerNode({ id: 'node-C', rttMs: 10, lastHeartbeat: Date.now(), connectedAt: Date.now(), status: 'active' });

      // Cycle 1: local - A
      coordinator.addLink(localId, 'node-A', 10);

      // Bridge: A - B
      coordinator.addLink('node-A', 'node-B', 20);

      // Cycle 2: B - C
      coordinator.addLink('node-B', 'node-C', 10);

      const bridges = coordinator.findBridges();
      expect(bridges.length).toBeGreaterThan(0);

      // The critical bridge edge connects the two subgraphs
      const bridgeStrings = bridges.map(([u, v]) => `${u}:${v}`);
      expect(
        bridgeStrings.includes('node-A:node-B') || bridgeStrings.includes('node-B:node-A')
      ).toBe(true);
    });

    it('detects multiple connected components and reports partitioned network health', () => {
      const coordinator = new MeshTopologyCoordinator({ localPeerId: localId });

      coordinator.addPeerNode({ id: 'node-A', rttMs: 10, lastHeartbeat: Date.now(), connectedAt: Date.now(), status: 'active' });
      coordinator.addPeerNode({ id: 'node-B', rttMs: 10, lastHeartbeat: Date.now(), connectedAt: Date.now(), status: 'active' });
      coordinator.addPeerNode({ id: 'node-isolated-1', rttMs: 50, lastHeartbeat: Date.now(), connectedAt: Date.now(), status: 'active' });
      coordinator.addPeerNode({ id: 'node-isolated-2', rttMs: 50, lastHeartbeat: Date.now(), connectedAt: Date.now(), status: 'active' });

      coordinator.addLink(localId, 'node-A', 10);
      coordinator.addLink('node-A', 'node-B', 10);

      // Disconnected component: isolated-1 <-> isolated-2
      coordinator.addLink('node-isolated-1', 'node-isolated-2', 15);

      const health = coordinator.assessTopologyHealth();
      expect(health.connectedComponents).toBe(2);
      expect(health.isPartitioned).toBe(true);
      expect(health.totalPeers).toBe(5);
    });
  });

  describe('Self-Healing Engine Optimization', () => {
    it('proposes connect candidates when degree is below target', () => {
      const coordinator = new MeshTopologyCoordinator({
        localPeerId: localId,
        minDegree: 3,
        targetDegree: 4,
      });

      coordinator.addPeerNode({ id: 'node-1', rttMs: 10, lastHeartbeat: Date.now(), connectedAt: Date.now(), status: 'active' });
      coordinator.addPeerNode({ id: 'node-2', rttMs: 15, lastHeartbeat: Date.now(), connectedAt: Date.now(), status: 'active' });
      coordinator.addPeerNode({ id: 'node-3', rttMs: 20, lastHeartbeat: Date.now(), connectedAt: Date.now(), status: 'active' });
      coordinator.addPeerNode({ id: 'node-4', isSupernode: true, rttMs: 30, lastHeartbeat: Date.now(), connectedAt: Date.now(), status: 'active' });

      // Local has 0 links currently
      const actions = coordinator.computeSelfHealingActions();

      expect(actions.connectCandidates.length).toBe(4);
      // Supernode should be prioritized at front
      expect(actions.connectCandidates[0]).toBe('node-4');
    });

    it('proposes pruning candidates when degree exceeds maximum', () => {
      const coordinator = new MeshTopologyCoordinator({
        localPeerId: localId,
        minDegree: 2,
        targetDegree: 2,
        maxDegree: 3,
      });

      // Add 4 links (exceeds maxDegree 3)
      for (let i = 1; i <= 4; i++) {
        const id = `node-${i}`;
        coordinator.addPeerNode({ id, rttMs: i * 20, lastHeartbeat: Date.now(), connectedAt: Date.now(), status: 'active' });
        coordinator.addLink(localId, id, i * 20);
      }

      // Add cross link between node-1 and node-4 so pruning local links does not break connectivity
      coordinator.addLink('node-1', 'node-2', 5);
      coordinator.addLink('node-2', 'node-3', 5);
      coordinator.addLink('node-3', 'node-4', 5);

      const actions = coordinator.computeSelfHealingActions();

      // Excess is 4 - 2 = 2
      expect(actions.pruneCandidates.length).toBe(2);
      // Highest latency link (node-4: 80ms) should be pruned first
      expect(actions.pruneCandidates[0]).toBe('node-4');
    });

    it('proposes bridge mitigation shortcuts', () => {
      const coordinator = new MeshTopologyCoordinator({ localPeerId: localId });

      // local - A - B (A is bridge between local and B)
      coordinator.addPeerNode({ id: 'node-A', rttMs: 10, lastHeartbeat: Date.now(), connectedAt: Date.now(), status: 'active' });
      coordinator.addPeerNode({ id: 'node-B', rttMs: 20, lastHeartbeat: Date.now(), connectedAt: Date.now(), status: 'active' });

      coordinator.addLink(localId, 'node-A', 10);
      coordinator.addLink('node-A', 'node-B', 20);

      const actions = coordinator.computeSelfHealingActions();

      // Should propose shortcut link between local and node-B
      expect(actions.bridgeMitigations.length).toBeGreaterThan(0);
      const [u, v] = actions.bridgeMitigations[0];
      expect(u).toBe(localId);
      expect(v).toBe('node-B');
    });
  });
});
