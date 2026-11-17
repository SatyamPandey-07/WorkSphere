import {
  PartykitRoomManager,
  type WebSocketLike,
  type ConnectionStatus,
  type VenueRoomEvent,
} from '@/lib/realtime/partykitRoomManager';

class MockWebSocket implements WebSocketLike {
  public readyState = 0; // CONNECTING
  public sentMessages: string[] = [];
  public isClosed = false;

  public onopen: ((event: unknown) => void) | null = null;
  public onclose: ((event: unknown) => void) | null = null;
  public onmessage: ((event: { data: string }) => void) | null = null;
  public onerror: ((event: unknown) => void) | null = null;

  constructor(public url: string) {}

  public send(data: string): void {
    this.sentMessages.push(data);
  }

  public close(): void {
    this.isClosed = true;
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose({});
  }

  public simulateOpen(): void {
    this.readyState = 1; // OPEN
    if (this.onopen) this.onopen({});
  }

  public simulateMessage(data: unknown): void {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }

  public simulateError(): void {
    if (this.onerror) this.onerror(new Error('Simulated network error'));
  }
}

describe('PartykitRoomManager - Reconnection Backoff & Delta State Sync (#7168)', () => {
  let createdSockets: MockWebSocket[] = [];

  const createManager = (overrides: Partial<any> = {}) => {
    createdSockets = [];
    return new PartykitRoomManager({
      room: 'venue-coworking-1',
      host: 'test.partykit.dev',
      initialBackoffMs: 500,
      maxBackoffMs: 30000,
      socketFactory: (url: string) => {
        const ws = new MockWebSocket(url);
        createdSockets.push(ws);
        return ws;
      },
      randomFn: () => 0.5, // Deterministic midpoint jitter
      ...overrides,
    });
  };

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Exponential Backoff with Full Jitter', () => {
    it('calculates backoff delay starting at initial 500ms and caps at 30s', () => {
      // With randomFn = () => 1.0 (maximum of full jitter range)
      const managerMaxJitter = createManager({ randomFn: () => 1.0 });

      // Attempt 1: min(30000, 500 * 2^0) = 500ms
      expect(managerMaxJitter.calculateBackoffDelay(1)).toBe(500);

      // Attempt 2: min(30000, 500 * 2^1) = 1000ms
      expect(managerMaxJitter.calculateBackoffDelay(2)).toBe(1000);

      // Attempt 3: min(30000, 500 * 2^2) = 2000ms
      expect(managerMaxJitter.calculateBackoffDelay(3)).toBe(2000);

      // Attempt 4: min(30000, 500 * 2^3) = 4000ms
      expect(managerMaxJitter.calculateBackoffDelay(4)).toBe(4000);

      // Attempt 7: min(30000, 500 * 2^6) = 30000ms (capped at 30s)
      expect(managerMaxJitter.calculateBackoffDelay(7)).toBe(30000);

      // Attempt 15: capped at 30000ms
      expect(managerMaxJitter.calculateBackoffDelay(15)).toBe(30000);
    });

    it('applies full jitter uniformly distributing delay between 0 and capped exponential', () => {
      // With randomFn = () => 0.25
      const managerQuarterJitter = createManager({ randomFn: () => 0.25 });
      expect(managerQuarterJitter.calculateBackoffDelay(1)).toBe(125); // 500 * 0.25
      expect(managerQuarterJitter.calculateBackoffDelay(2)).toBe(250); // 1000 * 0.25
    });
  });

  describe('Connection State Broadcasting', () => {
    it('broadcasts state transitions (reconnecting, connected, offline) to subscribers', () => {
      const manager = createManager();
      const stateHistory: ConnectionStatus[] = [];

      manager.onStateChange((state) => {
        stateHistory.push(state);
      });

      expect(stateHistory).toEqual(['offline']);

      // 1. Connect initiates reconnecting / connecting
      manager.connect();
      expect(stateHistory).toContain('reconnecting');

      // 2. Open transitions to connected
      const socket = createdSockets[0];
      socket.simulateOpen();
      expect(stateHistory[stateHistory.length - 1]).toBe('connected');

      // 3. Drop transitions back to reconnecting
      socket.close();
      expect(stateHistory[stateHistory.length - 1]).toBe('reconnecting');

      // 4. Manual disconnect transitions to offline
      manager.disconnect();
      expect(stateHistory[stateHistory.length - 1]).toBe('offline');
    });
  });

  describe('Automatic Reconnection Loop', () => {
    it('automatically reconnects when connection closes using backoff timer', () => {
      const manager = createManager({ randomFn: () => 1.0 });
      manager.connect();

      const ws1 = createdSockets[0];
      ws1.simulateOpen();
      expect(manager.getState()).toBe('connected');

      // Drop connection
      ws1.close();
      expect(manager.getState()).toBe('reconnecting');
      expect(createdSockets).toHaveLength(1);

      // Advance clock by backoff delay (attempt 1 = 500ms)
      jest.advanceTimersByTime(500);

      // New socket should be created for reconnection
      expect(createdSockets).toHaveLength(2);
      const ws2 = createdSockets[1];
      ws2.simulateOpen();
      expect(manager.getState()).toBe('connected');
    });
  });

  describe('CRDT Delta State Re-synchronization', () => {
    it('requests delta state vector on reconnection with previous sequence ID', () => {
      const manager = createManager();
      manager.connect();

      const ws1 = createdSockets[0];
      ws1.simulateOpen();

      // Receive initial event with sequenceId = 12
      ws1.simulateMessage({
        type: 'seat_update',
        sequenceId: 12,
        epoch: 1001,
        event: {
          sequenceId: 12,
          epoch: 1001,
          type: 'seat_checkin',
          seat: {
            seatId: 'seat-42',
            userId: 'user-alice',
            status: 'OCCUPIED',
            timestamp: Date.now(),
            sequenceId: 12,
          },
        },
      });

      expect(manager.getLastSequenceId()).toBe(12);
      expect(manager.getSeats().get('seat-42')?.status).toBe('OCCUPIED');

      // Simulate connection drop
      ws1.close();

      // Advance timers to trigger reconnect
      jest.advanceTimersByTime(1000);

      const ws2 = createdSockets[1];
      // URL should now carry lastSeq=12
      expect(ws2.url).toContain('lastSeq=12');

      ws2.simulateOpen();

      // Check that sync_request was sent through the socket
      const syncMsg = JSON.parse(ws2.sentMessages[0]);
      expect(syncMsg.type).toBe('sync_request');
      expect(syncMsg.lastSeq).toBe(12);
      expect(syncMsg.epoch).toBe(1001);
    });

    it('reconciles missed real-time check-in events from sync_replay without page refresh', () => {
      const manager = createManager();
      manager.connect();

      const ws = createdSockets[0];
      ws.simulateOpen();

      const syncEventsReceived: VenueRoomEvent[][] = [];
      manager.onSync((events) => {
        syncEventsReceived.push(events);
      });

      // Server replays missed delta events 13 and 14
      ws.simulateMessage({
        type: 'sync_replay',
        fromSeq: 13,
        toSeq: 14,
        epoch: 1001,
        events: [
          {
            sequenceId: 13,
            epoch: 1001,
            type: 'seat_checkin',
            seat: {
              seatId: 'seat-A1',
              userId: 'user-bob',
              status: 'OCCUPIED',
              timestamp: Date.now(),
              sequenceId: 13,
            },
          },
          {
            sequenceId: 14,
            epoch: 1001,
            type: 'seat_checkin',
            seat: {
              seatId: 'seat-A2',
              userId: 'user-charlie',
              status: 'OCCUPIED',
              timestamp: Date.now(),
              sequenceId: 14,
            },
          },
        ],
      });

      expect(manager.getLastSequenceId()).toBe(14);
      expect(manager.getSeats().get('seat-A1')?.userId).toBe('user-bob');
      expect(manager.getSeats().get('seat-A2')?.userId).toBe('user-charlie');
      expect(syncEventsReceived).toHaveLength(1);
      expect(syncEventsReceived[0]).toHaveLength(2);
    });

    it('handles sync_fallback snapshot reconciliation on sequence gap or epoch mismatch', () => {
      const manager = createManager();
      manager.connect();

      const ws = createdSockets[0];
      ws.simulateOpen();

      ws.simulateMessage({
        type: 'sync_fallback',
        reason: 'history_unavailable',
        epoch: 2002,
        latestSeq: 55,
        seats: [
          {
            seatId: 'seat-VIP',
            userId: 'user-vip',
            status: 'OCCUPIED',
            timestamp: Date.now(),
            sequenceId: 55,
          },
        ],
      });

      expect(manager.getLastSequenceId()).toBe(55);
      expect(manager.getEpoch()).toBe(2002);
      expect(manager.getSeats().get('seat-VIP')?.userId).toBe('user-vip');
    });
  });

  describe('Seat Check-in Actions', () => {
    it('sends seat check-in message when connected', () => {
      const manager = createManager();
      manager.connect();

      const ws = createdSockets[0];
      ws.simulateOpen();

      manager.checkIn('desk-9', 'user-dave', 'Dave');

      const sent = JSON.parse(ws.sentMessages[0]);
      expect(sent.type).toBe('seat_checkin');
      expect(sent.seatId).toBe('desk-9');
      expect(sent.userId).toBe('user-dave');
    });

    it('throws when checking in while disconnected', () => {
      const manager = createManager();
      expect(() => {
        manager.checkIn('desk-9', 'user-dave');
      }).toThrow('Cannot check in: PartyKit socket is not connected');
    });
  });
});
