import { HeartbeatMonitor, HeartbeatEvent } from '../../party/mesh/HeartbeatMonitor';
import { RegionNode } from '../../party/mesh/RegionRouter';

describe('HeartbeatMonitor Adaptive Jacobson-Karels Estimator', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  const createNode = (id: string, latencyMs: number = 0): RegionNode => ({
    id,
    region: 'us-east-1',
    endpoint: `https://${id}.mesh.internal`,
    latencyMs,
    lastSeen: Date.now(),
    isActive: true,
  });

  describe('Jacobson-Karels RTT and Jitter Estimation', () => {
    it('initializes SRTT and RTTVAR correctly on first measurement', () => {
      const monitor = new HeartbeatMonitor();
      const node = createNode('node-1');
      monitor.addNode(node);

      monitor.recordHeartbeat('node-1', 100);

      const stats = monitor.getNodeRttStats('node-1');
      expect(stats).toBeDefined();
      // First sample: SRTT = R', RTTVAR = R' / 2
      expect(stats?.srtt).toBe(100);
      expect(stats?.rttvar).toBe(50);
      // RTO = SRTT + 4 * RTTVAR = 100 + 4 * 50 = 300ms
      expect(stats?.rto).toBe(500); // clamped to minTimeoutMs (500ms)
    });

    it('updates SRTT and RTTVAR on subsequent measurements using Jacobson-Karels formula', () => {
      const monitor = new HeartbeatMonitor();
      const node = createNode('node-1');
      monitor.addNode(node);

      // Sample 1: 100ms
      monitor.recordHeartbeat('node-1', 100);
      // Sample 2: 140ms
      monitor.recordHeartbeat('node-1', 140);

      const stats = monitor.getNodeRttStats('node-1');
      expect(stats).toBeDefined();
      // Delta = |100 - 140| = 40
      // RTTVAR = (1 - 0.25) * 50 + 0.25 * 40 = 37.5 + 10 = 47.5
      // SRTT = (1 - 0.125) * 100 + 0.125 * 140 = 87.5 + 17.5 = 105
      expect(stats?.srtt).toBeCloseTo(105, 3);
      expect(stats?.rttvar).toBeCloseTo(47.5, 3);
      // Raw RTO = 105 + 4 * 47.5 = 105 + 190 = 295 -> clamped to 500ms
      expect(stats?.rto).toBe(500);
    });

    it('scales RTO above floor when network latency and variance are high', () => {
      const monitor = new HeartbeatMonitor();
      const node = createNode('node-mobile');
      monitor.addNode(node);

      // Sample 1: 1000ms
      monitor.recordHeartbeat('node-mobile', 1000);
      // Sample 2: 2000ms (high jitter)
      monitor.recordHeartbeat('node-mobile', 2000);

      const stats = monitor.getNodeRttStats('node-mobile');
      // Sample 1: SRTT = 1000, RTTVAR = 500
      // Sample 2: delta = 1000
      // RTTVAR = 0.75 * 500 + 0.25 * 1000 = 375 + 250 = 625
      // SRTT = 0.875 * 1000 + 0.125 * 2000 = 875 + 250 = 1125
      // Raw RTO = 1125 + 4 * 625 = 1125 + 2500 = 3625ms
      expect(stats?.rto).toBeCloseTo(3625, 1);
      expect(monitor.getTimeoutThreshold('node-mobile')).toBeCloseTo(3625, 1);
    });
  });

  describe('Adaptive Heartbeat Interval Scheduling', () => {
    it('tightens heartbeat intervals during low-latency connections', () => {
      const monitor = new HeartbeatMonitor();
      const node = createNode('node-fast');
      monitor.addNode(node);

      // Multiple low-latency samples (20ms)
      for (let i = 0; i < 5; i++) {
        monitor.recordHeartbeat('node-fast', 20);
      }

      const interval = monitor.getHeartbeatInterval('node-fast');
      // Low latency clamps to minIntervalMs (250ms)
      expect(interval).toBe(250);
      expect(monitor.getHeartbeatInterval()).toBe(250);
    });

    it('adaptively lengthens heartbeat interval on high latency and jitter', () => {
      const monitor = new HeartbeatMonitor();
      const node = createNode('node-slow');
      monitor.addNode(node);

      // High latency with high jitter
      monitor.recordHeartbeat('node-slow', 2000);
      monitor.recordHeartbeat('node-slow', 3500);

      const stats = monitor.getNodeRttStats('node-slow');
      expect(stats).toBeDefined();
      expect(stats!.heartbeatIntervalMs).toBeGreaterThan(1500);
      expect(monitor.getHeartbeatInterval('node-slow')).toBe(stats!.heartbeatIntervalMs);
    });
  });

  describe('Acceptance Criteria 1: Prevents False-Positive Disconnects on Mobile Networks', () => {
    it('prevents false-positive disconnect when packets suffer high latency and jitter', () => {
      // Configure monitor with custom low baseline timeout to contrast with adaptive behavior
      const monitor = new HeartbeatMonitor({
        timeoutThresholdMs: 2000,
        minTimeoutMs: 500,
        maxTimeoutMs: 15000,
      });

      const node = createNode('node-mobile');
      monitor.addNode(node);

      // Establish high latency & jitter profile
      monitor.recordHeartbeat('node-mobile', 1500);
      monitor.recordHeartbeat('node-mobile', 2500);

      const events: HeartbeatEvent[] = [];
      monitor.onHeartbeat((evt) => events.push(evt));

      // Timeout threshold should have expanded well past 3000ms
      const timeoutThreshold = monitor.getTimeoutThreshold('node-mobile');
      expect(timeoutThreshold).toBeGreaterThan(3000);

      // Advance time by 2500ms (which would have exceeded a 2000ms static threshold)
      jest.advanceTimersByTime(2500);
      monitor.checkHealth();

      // Node should remain alive and NOT be marked dead
      const deadEvents = events.filter((e) => e.status === 'dead');
      expect(deadEvents).toHaveLength(0);

      // Delayed packet arrives at 2500ms
      monitor.recordHeartbeat('node-mobile', 1800);
      const aliveEvents = events.filter((e) => e.status === 'alive');
      expect(aliveEvents.length).toBeGreaterThan(0);
    });
  });

  describe('Acceptance Criteria 2: Sub-Second Failover on Low-Latency Connections', () => {
    it('detects node failure and triggers failover in under 1000ms', () => {
      const monitor = new HeartbeatMonitor({
        minIntervalMs: 200,
        minTimeoutMs: 500,
      });

      const node = createNode('node-lan');
      monitor.addNode(node);

      // High-frequency low-latency connection (15ms RTT)
      for (let i = 0; i < 5; i++) {
        monitor.recordHeartbeat('node-lan', 15);
      }

      // Dynamic timeout threshold is clamped to sub-second floor (500ms)
      expect(monitor.getTimeoutThreshold('node-lan')).toBe(500);
      expect(monitor.getHeartbeatInterval('node-lan')).toBe(250); // RTO/2 = 250ms

      const events: HeartbeatEvent[] = [];
      monitor.onHeartbeat((evt) => events.push(evt));

      // Node goes completely silent. Advance time past the 500ms timeout threshold (e.g. 600ms)
      jest.advanceTimersByTime(600);

      // Node should be detected as dead within sub-second timeframe (< 1000ms)
      const deadEvents = events.filter((e) => e.status === 'dead');
      expect(deadEvents).toHaveLength(1);
      expect(deadEvents[0].nodeId).toBe('node-lan');
    });
  });

  describe('Multi-Node Coordination & Lifecycle', () => {
    it('prioritizes the tighter heartbeat interval across mixed peers', () => {
      const monitor = new HeartbeatMonitor();
      const fastNode = createNode('fast-node');
      const slowNode = createNode('slow-node');

      monitor.addNode(fastNode);
      monitor.addNode(slowNode);

      // Fast node: 20ms
      monitor.recordHeartbeat('fast-node', 20);
      // Slow node: 3000ms
      monitor.recordHeartbeat('slow-node', 3000);

      // Fast node wants 250ms interval, Slow node wants ~4500ms interval
      expect(monitor.getHeartbeatInterval('fast-node')).toBe(250);
      expect(monitor.getHeartbeatInterval('slow-node')).toBeGreaterThan(4000);

      // Overall active interval must be the tighter one (250ms) to ensure fast node is monitored
      expect(monitor.getHeartbeatInterval()).toBe(250);
    });

    it('reactivates a dead node when a subsequent heartbeat arrives', () => {
      const monitor = new HeartbeatMonitor({ minTimeoutMs: 500, minIntervalMs: 250 });
      const node = createNode('node-flaky');
      monitor.addNode(node);
      monitor.recordHeartbeat('node-flaky', 30);

      const events: HeartbeatEvent[] = [];
      monitor.onHeartbeat((evt) => events.push(evt));

      // Advance past timeout to mark dead
      jest.advanceTimersByTime(600);
      expect(events.filter((e) => e.status === 'dead')).toHaveLength(1);

      // Node recovers and sends heartbeat
      monitor.recordHeartbeat('node-flaky', 25);
      const aliveEvents = events.filter((e) => e.status === 'alive');
      expect(aliveEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('stops monitoring timer when all nodes are removed', () => {
      const monitor = new HeartbeatMonitor();
      const node1 = createNode('node-1');
      const node2 = createNode('node-2');

      monitor.addNode(node1);
      monitor.addNode(node2);
      expect(jest.getTimerCount()).toBe(1);

      monitor.removeNode('node-1');
      expect(jest.getTimerCount()).toBe(1);

      monitor.removeNode('node-2');
      // All nodes removed -> monitoring should stop
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
