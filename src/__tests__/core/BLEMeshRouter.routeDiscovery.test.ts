import { BLEMeshRouter } from '@/core/network/BLEMeshRouter';

describe('BLEMeshRouter AODV Route Discovery & Exponential Backoff (#5768)', () => {
  let nodeA: BLEMeshRouter;
  let nodeB: BLEMeshRouter;
  let nodeC: BLEMeshRouter;
  let nodeD: BLEMeshRouter;

  beforeEach(() => {
    nodeA = new BLEMeshRouter('node-a');
    nodeB = new BLEMeshRouter('node-b');
    nodeC = new BLEMeshRouter('node-c');
    nodeD = new BLEMeshRouter('node-d');

    // Build linear 4-node mesh topology: A <-> B <-> C <-> D
    nodeA.addNeighbor('node-b', nodeB);
    nodeB.addNeighbor('node-a', nodeA);

    nodeB.addNeighbor('node-c', nodeC);
    nodeC.addNeighbor('node-b', nodeB);

    nodeC.addNeighbor('node-d', nodeD);
    nodeD.addNeighbor('node-c', nodeC);
  });

  it('discovers multi-hop route across 4 simulated nodes (Node A -> Node B -> Node C -> Node D)', () => {
    // Initially, Node A has no route to Node D
    expect(nodeA.getRoute('node-d')).toBeUndefined();

    // Node A initiates route discovery broadcast for Node D
    const rreq = nodeA.broadcastRREQ('node-d');
    expect(rreq.sourceNodeId).toBe('node-a');
    expect(rreq.targetNodeId).toBe('node-d');
    expect(rreq.visitedNodes).toContain('node-a');

    // Route from Node A to Node D should be resolved via nextHop Node B with hop count 3
    const routeAToD = nodeA.getRoute('node-d');
    expect(routeAToD).toBeDefined();
    expect(routeAToD?.destination).toBe('node-d');
    expect(routeAToD?.nextHop).toBe('node-b');
    expect(routeAToD?.hopCount).toBe(3);
    expect(routeAToD?.status).toBe('active');

    // Node D should have learned the reverse route to Node A via nextHop Node C with hop count 3
    const routeDToA = nodeD.getRoute('node-a');
    expect(routeDToA).toBeDefined();
    expect(routeDToA?.destination).toBe('node-a');
    expect(routeDToA?.nextHop).toBe('node-c');
    expect(routeDToA?.hopCount).toBe(3);
    expect(routeDToA?.status).toBe('active');

    // Intermediate nodes should also have cached valid forward and reverse routes
    const routeBToD = nodeB.getRoute('node-d');
    expect(routeBToD?.nextHop).toBe('node-c');
    expect(routeBToD?.hopCount).toBe(2);

    const routeCToD = nodeC.getRoute('node-d');
    expect(routeCToD?.nextHop).toBe('node-d');
    expect(routeCToD?.hopCount).toBe(1);
  });

  it('caches discovered routes with 5-minute expiration timestamp and evicts expired routes', () => {
    const fixedNow = 1700000000000;
    jest.spyOn(Date, 'now').mockReturnValue(fixedNow);

    nodeA.broadcastRREQ('node-d', fixedNow);

    const route = nodeA.getRoute('node-d', fixedNow);
    expect(route).toBeDefined();
    expect(route?.expiresAt).toBe(fixedNow + BLEMeshRouter.ROUTE_CACHE_TTL_MS);
    expect(BLEMeshRouter.ROUTE_CACHE_TTL_MS).toBe(5 * 60 * 1000);

    // After 4 minutes and 59 seconds, route is still active
    const insideTTL = fixedNow + (4 * 60 * 1000 + 59 * 1000);
    expect(nodeA.getRoute('node-d', insideTTL)).toBeDefined();
    expect(nodeA.getRoutingTable(insideTTL).has('node-d')).toBe(true);

    // After 5 minutes, route expires and is evicted
    const afterTTL = fixedNow + (5 * 60 * 1000);
    expect(nodeA.getRoute('node-d', afterTTL)).toBeUndefined();
    expect(nodeA.getRoutingTable(afterTTL).has('node-d')).toBe(false);

    (Date.now as jest.Mock).mockRestore();
  });

  it('implements exponential backoff on repeated route discovery attempts for unreachable nodes', () => {
    const start = 1700000000000;
    const unreachableTarget = 'node-unreachable';

    // 1st attempt at t=0: backoff 1000ms * 2^0 = 1000ms
    nodeA.broadcastRREQ(unreachableTarget, start);
    let pending = nodeA.getPendingDiscovery(unreachableTarget);
    expect(pending?.attemptCount).toBe(1);
    expect(pending?.nextRetryTimestamp).toBe(start + 1000);

    // Attempt before backoff expires (t=500ms) should be throttled without incrementing attemptCount
    nodeA.broadcastRREQ(unreachableTarget, start + 500);
    pending = nodeA.getPendingDiscovery(unreachableTarget);
    expect(pending?.attemptCount).toBe(1);
    expect(pending?.nextRetryTimestamp).toBe(start + 1000);

    // 2nd attempt after 1000ms backoff (t=1000ms): backoff 1000ms * 2^1 = 2000ms
    nodeA.broadcastRREQ(unreachableTarget, start + 1000);
    pending = nodeA.getPendingDiscovery(unreachableTarget);
    expect(pending?.attemptCount).toBe(2);
    expect(pending?.nextRetryTimestamp).toBe(start + 1000 + 2000);

    // 3rd attempt after 2000ms backoff (t=3000ms): backoff 1000ms * 2^2 = 4000ms
    nodeA.broadcastRREQ(unreachableTarget, start + 3000);
    pending = nodeA.getPendingDiscovery(unreachableTarget);
    expect(pending?.attemptCount).toBe(3);
    expect(pending?.nextRetryTimestamp).toBe(start + 3000 + 4000);

    // 4th attempt after 4000ms backoff (t=7000ms): backoff 1000ms * 2^3 = 8000ms
    nodeA.broadcastRREQ(unreachableTarget, start + 7000);
    pending = nodeA.getPendingDiscovery(unreachableTarget);
    expect(pending?.attemptCount).toBe(4);
    expect(pending?.nextRetryTimestamp).toBe(start + 7000 + 8000);
  });

  it('resets pending discovery backoff once route is successfully resolved', () => {
    const start = 1700000000000;
    nodeA.broadcastRREQ('node-d', start);

    const pending = nodeA.getPendingDiscovery('node-d');
    expect(pending?.status).toBe('resolved');
    expect(pending?.attemptCount).toBe(0);
    expect(pending?.nextRetryTimestamp).toBe(0);
  });

  it('prefers routes with lower hop count and ignores longer routes', () => {
    // Manually test handleRREP with a 3-hop route then a 2-hop route
    const now = Date.now();
    nodeA.handleRREP({
      type: 'RREP',
      requestId: 'req-1',
      sourceNodeId: 'node-a',
      targetNodeId: 'remote-target',
      responderNodeId: 'remote-target',
      nextHop: 'node-b',
      hopCount: 3,
      expiresAt: now + 300000,
    }, 'node-b');

    let route = nodeA.getRoute('remote-target');
    expect(route?.hopCount).toBe(4);
    expect(route?.nextHop).toBe('node-b');

    // Receiving a shorter 1-hop path via node-b
    nodeA.handleRREP({
      type: 'RREP',
      requestId: 'req-2',
      sourceNodeId: 'node-a',
      targetNodeId: 'remote-target',
      responderNodeId: 'remote-target',
      nextHop: 'node-c',
      hopCount: 1,
      expiresAt: now + 300000,
    }, 'node-c');

    route = nodeA.getRoute('remote-target');
    expect(route?.hopCount).toBe(2);
    expect(route?.nextHop).toBe('node-c');

    // Receiving a longer 5-hop path should be ignored
    nodeA.handleRREP({
      type: 'RREP',
      requestId: 'req-3',
      sourceNodeId: 'node-a',
      targetNodeId: 'remote-target',
      responderNodeId: 'remote-target',
      nextHop: 'node-b',
      hopCount: 5,
      expiresAt: now + 300000,
    }, 'node-b');

    route = nodeA.getRoute('remote-target');
    expect(route?.hopCount).toBe(2);
    expect(route?.nextHop).toBe('node-c');
  });
});
