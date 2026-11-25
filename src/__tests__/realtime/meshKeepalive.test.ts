import {
  DATA_CHANNEL_KEEPALIVE_INTERVAL_MS,
  startDataChannelKeepalive,
  stopDataChannelKeepalive,
  isDataChannelKeepaliveActive,
  isKeepalivePacket,
  registerMeshPeerDataChannel,
  MeshPeerConnection,
} from '@/lib/realtime/webrtc/meshConnection';

interface MockDataChannel {
  readyState: RTCDataChannelState;
  send: jest.Mock;
  close: jest.Mock;
  addEventListener: jest.Mock;
  removeEventListener: jest.Mock;
  dispatchEvent: (event: any) => boolean;
  onopen: ((ev: Event) => any) | null;
  onmessage: ((ev: MessageEvent) => any) | null;
  onclose: ((ev: Event) => any) | null;
  onerror: ((ev: Event) => any) | null;
}

function createMockDataChannel(initialState: RTCDataChannelState = 'connecting'): MockDataChannel {
  const listeners: Record<string, Set<(ev: any) => void>> = {};

  const channel: MockDataChannel = {
    readyState: initialState,
    send: jest.fn(),
    close: jest.fn().mockImplementation(() => {
      channel.readyState = 'closed';
      channel.dispatchEvent({ type: 'close' });
    }),
    addEventListener: jest.fn((type: string, listener: (ev: any) => void) => {
      if (!listeners[type]) listeners[type] = new Set();
      listeners[type].add(listener);
    }),
    removeEventListener: jest.fn((type: string, listener: (ev: any) => void) => {
      listeners[type]?.delete(listener);
    }),
    dispatchEvent: (event: any) => {
      let stopped = false;
      event.stopImmediatePropagation = () => {
        stopped = true;
      };

      const set = listeners[event.type];
      if (set) {
        for (const listener of Array.from(set)) {
          if (stopped) break;
          listener(event);
        }
      }

      if (!stopped) {
        if (event.type === 'open' && channel.onopen) channel.onopen(event);
        if (event.type === 'message' && channel.onmessage) channel.onmessage(event);
        if (event.type === 'close' && channel.onclose) channel.onclose(event);
        if (event.type === 'error' && channel.onerror) channel.onerror(event);
      }
      return !event.defaultPrevented;
    },
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
  };

  return channel;
}

describe('WebRTC DataChannel Keepalive Ping/Pong (#9895)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('Ping transmission', () => {
    it('1. No PING is sent before the DataChannel opens', () => {
      const channel = createMockDataChannel('connecting');
      startDataChannelKeepalive(channel as unknown as RTCDataChannel);

      jest.advanceTimersByTime(DATA_CHANNEL_KEEPALIVE_INTERVAL_MS * 2);
      expect(channel.send).not.toHaveBeenCalled();
      expect(isDataChannelKeepaliveActive(channel as unknown as RTCDataChannel)).toBe(false);
    });

    it('2. A PING is sent after 15 seconds once open', () => {
      const channel = createMockDataChannel('connecting');
      startDataChannelKeepalive(channel as unknown as RTCDataChannel);

      // Transition to open
      channel.readyState = 'open';
      channel.dispatchEvent({ type: 'open' });

      expect(isDataChannelKeepaliveActive(channel as unknown as RTCDataChannel)).toBe(true);
      expect(channel.send).not.toHaveBeenCalled();

      // Advance by 15s
      jest.advanceTimersByTime(15_000);
      expect(channel.send).toHaveBeenCalledTimes(1);
    });

    it('3. PING packets contain type: "PING" and a numeric timestamp', () => {
      const channel = createMockDataChannel('open');
      startDataChannelKeepalive(channel as unknown as RTCDataChannel);

      const fakeNow = 1700000000000;
      jest.spyOn(Date, 'now').mockReturnValue(fakeNow);

      jest.advanceTimersByTime(15_000);
      expect(channel.send).toHaveBeenCalledTimes(1);

      const sentPayload = JSON.parse(channel.send.mock.calls[0][0]);
      expect(sentPayload).toEqual({
        type: 'PING',
        ts: fakeNow,
      });
      expect(isKeepalivePacket(sentPayload)).toBe(true);
    });

    it('4. Subsequent PING packets are sent at 15-second intervals', () => {
      const channel = createMockDataChannel('open');
      startDataChannelKeepalive(channel as unknown as RTCDataChannel);

      jest.advanceTimersByTime(15_000);
      expect(channel.send).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(15_000);
      expect(channel.send).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(15_000);
      expect(channel.send).toHaveBeenCalledTimes(3);

      jest.advanceTimersByTime(30_000);
      expect(channel.send).toHaveBeenCalledTimes(5);
    });

    it('5. No PING is sent when the channel is not open (e.g. closing or closed)', () => {
      const channel = createMockDataChannel('open');
      startDataChannelKeepalive(channel as unknown as RTCDataChannel);

      jest.advanceTimersByTime(15_000);
      expect(channel.send).toHaveBeenCalledTimes(1);

      // Transition to closing
      channel.readyState = 'closing';
      jest.advanceTimersByTime(15_000);

      // No new ping should be sent while closing/closed
      expect(channel.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('Pong response & message interception', () => {
    it('6. Receiving a valid PING produces a PONG response', () => {
      const channel = createMockDataChannel('open');
      startDataChannelKeepalive(channel as unknown as RTCDataChannel);

      const pingPacket = { type: 'PING', ts: 123456789 };
      channel.dispatchEvent({
        type: 'message',
        data: JSON.stringify(pingPacket),
      });

      expect(channel.send).toHaveBeenCalledTimes(1);
      const pongResponse = JSON.parse(channel.send.mock.calls[0][0]);
      expect(pongResponse.type).toBe('PONG');
    });

    it('7. The PONG contains the expected echoed timestamp', () => {
      const channel = createMockDataChannel('open');
      startDataChannelKeepalive(channel as unknown as RTCDataChannel);

      const pingTimestamp = 987654321;
      channel.dispatchEvent({
        type: 'message',
        data: JSON.stringify({ type: 'PING', ts: pingTimestamp }),
      });

      const pongResponse = JSON.parse(channel.send.mock.calls[0][0]);
      expect(pongResponse).toEqual({
        type: 'PONG',
        ts: pingTimestamp,
      });
    });

    it('8. PING is not forwarded to application-level handlers', () => {
      const channel = createMockDataChannel('open');
      startDataChannelKeepalive(channel as unknown as RTCDataChannel);

      const appHandler = jest.fn();
      channel.addEventListener('message', appHandler);

      channel.dispatchEvent({
        type: 'message',
        data: JSON.stringify({ type: 'PING', ts: 55555 }),
      });

      // Heartbeat listener calls stopImmediatePropagation on matching ping/pong
      expect(appHandler).not.toHaveBeenCalled();
    });

    it('9. Receiving a PONG is consumed internally and invokes onPongReceived', () => {
      const channel = createMockDataChannel('open');
      const onPongReceived = jest.fn();

      startDataChannelKeepalive(channel as unknown as RTCDataChannel, {
        onPongReceived,
      });

      const appHandler = jest.fn();
      channel.addEventListener('message', appHandler);

      const pongTimestamp = 1000;
      jest.spyOn(Date, 'now').mockReturnValue(1050);

      channel.dispatchEvent({
        type: 'message',
        data: JSON.stringify({ type: 'PONG', ts: pongTimestamp }),
      });

      // Consumed internally
      expect(appHandler).not.toHaveBeenCalled();
      expect(onPongReceived).toHaveBeenCalledWith(pongTimestamp, 50);
    });

    it('10. Malformed JSON does not crash the handler and forwards to app', () => {
      const channel = createMockDataChannel('open');
      startDataChannelKeepalive(channel as unknown as RTCDataChannel);

      const appHandler = jest.fn();
      channel.addEventListener('message', appHandler);

      expect(() => {
        channel.dispatchEvent({
          type: 'message',
          data: '{ invalid json payload ...',
        });
      }).not.toThrow();

      expect(appHandler).toHaveBeenCalledTimes(1);
    });

    it('11. Unrelated application messages continue through normal message handlers', () => {
      const channel = createMockDataChannel('open');
      startDataChannelKeepalive(channel as unknown as RTCDataChannel);

      const appHandler = jest.fn();
      channel.addEventListener('message', appHandler);

      const appData = JSON.stringify({ type: 'whiteboard:draw', x: 10, y: 20 });
      channel.dispatchEvent({
        type: 'message',
        data: appData,
      });

      expect(appHandler).toHaveBeenCalledTimes(1);
      expect(appHandler.mock.calls[0][0].data).toBe(appData);

      // Binary ArrayBuffer data also passes through
      const arrayBuffer = new ArrayBuffer(8);
      channel.dispatchEvent({
        type: 'message',
        data: arrayBuffer,
      });
      expect(appHandler).toHaveBeenCalledTimes(2);
    });
  });

  describe('Lifecycle cleanup', () => {
    it('12. Closing the DataChannel clears its keepalive interval', () => {
      const channel = createMockDataChannel('open');
      startDataChannelKeepalive(channel as unknown as RTCDataChannel);

      expect(isDataChannelKeepaliveActive(channel as unknown as RTCDataChannel)).toBe(true);

      // Dispatch close
      channel.close();
      expect(isDataChannelKeepaliveActive(channel as unknown as RTCDataChannel)).toBe(false);

      jest.advanceTimersByTime(30_000);
      expect(channel.send).not.toHaveBeenCalled();
    });

    it('13. No PING is sent after closure', () => {
      const channel = createMockDataChannel('open');
      startDataChannelKeepalive(channel as unknown as RTCDataChannel);

      jest.advanceTimersByTime(15_000);
      expect(channel.send).toHaveBeenCalledTimes(1);

      channel.readyState = 'closed';
      channel.dispatchEvent({ type: 'close' });

      jest.advanceTimersByTime(60_000);
      expect(channel.send).toHaveBeenCalledTimes(1);
    });

    it('14. Error and connection teardown clean up timers appropriately', () => {
      const channel = createMockDataChannel('open');
      startDataChannelKeepalive(channel as unknown as RTCDataChannel);

      expect(isDataChannelKeepaliveActive(channel as unknown as RTCDataChannel)).toBe(true);

      channel.readyState = 'closed';
      channel.dispatchEvent({ type: 'error' });

      expect(isDataChannelKeepaliveActive(channel as unknown as RTCDataChannel)).toBe(false);
    });

    it('15. Repeated lifecycle events or repeated start calls do not create duplicate intervals', () => {
      const channel = createMockDataChannel('open');

      // Calling start multiple times
      startDataChannelKeepalive(channel as unknown as RTCDataChannel);
      startDataChannelKeepalive(channel as unknown as RTCDataChannel);
      startDataChannelKeepalive(channel as unknown as RTCDataChannel);

      // Dispatch duplicate open events
      channel.dispatchEvent({ type: 'open' });
      channel.dispatchEvent({ type: 'open' });

      // After 15s, exactly 1 ping should be sent
      jest.advanceTimersByTime(15_000);
      expect(channel.send).toHaveBeenCalledTimes(1);
    });

    it('16. stopDataChannelKeepalive and cleanup can safely run more than once (idempotent)', () => {
      const channel = createMockDataChannel('open');
      startDataChannelKeepalive(channel as unknown as RTCDataChannel);

      expect(() => {
        stopDataChannelKeepalive(channel as unknown as RTCDataChannel);
        stopDataChannelKeepalive(channel as unknown as RTCDataChannel);
        stopDataChannelKeepalive(null as any);
      }).not.toThrow();

      expect(isDataChannelKeepaliveActive(channel as unknown as RTCDataChannel)).toBe(false);
    });

    it('17. MeshPeerConnection integration cleans up registered DataChannels on close', () => {
      const mockPc = {
        close: jest.fn(),
        onicecandidate: null,
        oniceconnectionstatechange: null,
      };
      (globalThis as any).RTCPeerConnection = jest.fn().mockImplementation(() => mockPc);

      const peer = new MeshPeerConnection({ peerId: 'peer-test' });
      const channel = createMockDataChannel('open');

      registerMeshPeerDataChannel(peer, channel as unknown as RTCDataChannel);
      expect(isDataChannelKeepaliveActive(channel as unknown as RTCDataChannel)).toBe(true);

      peer.close();
      expect(isDataChannelKeepaliveActive(channel as unknown as RTCDataChannel)).toBe(false);

      jest.advanceTimersByTime(30_000);
      expect(channel.send).not.toHaveBeenCalled();
    });
  });
});
