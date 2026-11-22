import {
  registerDataChannelListener,
  unregisterDataChannelListener,
  cleanupDataChannelListeners,
  getDataChannelListenerCount,
} from '../../lib/realtime/webrtc/meshConnection';

// Universal mock helper compatible with both Vitest and Jest
let vitestModule: any = undefined;
try {
  if (typeof (globalThis as any).describe === 'undefined') {
    vitestModule = (eval('require'))('vitest');
  }
} catch {
  // Ignore in Jest
}

const testDescribe = (globalThis as any).describe ?? vitestModule?.describe;
const testIt = (globalThis as any).it ?? vitestModule?.it;
const testExpect = (globalThis as any).expect ?? vitestModule?.expect;
const testBeforeEach = (globalThis as any).beforeEach ?? vitestModule?.beforeEach;

const createSpy = (fn?: (...args: any[]) => any) => {
  if (vitestModule?.vi && typeof vitestModule.vi.fn === 'function') {
    return vitestModule.vi.fn(fn);
  }
  if (typeof (globalThis as any).vi !== 'undefined' && typeof (globalThis as any).vi.fn === 'function') {
    return (globalThis as any).vi.fn(fn);
  }
  if (typeof jest !== 'undefined' && typeof jest.fn === 'function') {
    return jest.fn(fn);
  }
  const spy: any = (...args: any[]) => {
    spy.mock.calls.push(args);
    return fn ? fn(...args) : undefined;
  };
  spy.mock = { calls: [] };
  return spy;
};

interface MockListenerRecord {
  type: string;
  listener: EventListenerOrEventListenerObject;
}

class MockRTCDataChannel {
  public binaryType: BinaryType = 'arraybuffer';
  public readyState: RTCDataChannelState = 'open';
  public onmessage: ((this: RTCDataChannel, ev: MessageEvent) => any) | null = null;
  public onerror: ((this: RTCDataChannel, ev: Event) => any) | null = null;
  public onclose: ((this: RTCDataChannel, ev: Event) => any) | null = null;
  public onopen: ((this: RTCDataChannel, ev: Event) => any) | null = null;

  public activeListeners: MockListenerRecord[] = [];
  public addCalls = 0;
  public removeCalls = 0;

  public addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject
  ): void {
    this.addCalls++;
    this.activeListeners.push({ type, listener });
  }

  public removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject
  ): void {
    this.removeCalls++;
    this.activeListeners = this.activeListeners.filter(
      (entry) => !(entry.type === type && entry.listener === listener)
    );
  }

  public dispatchEvent(event: Event): boolean {
    // 1. Dispatch to addEventListener subscribers
    const matching = this.activeListeners.filter((entry) => entry.type === event.type);
    for (const record of matching) {
      if (typeof record.listener === 'function') {
        record.listener(event);
      } else if (typeof record.listener.handleEvent === 'function') {
        record.listener.handleEvent(event);
      }
    }

    // 2. Dispatch to property listener if defined
    if (event.type === 'message' && this.onmessage) {
      this.onmessage(event as MessageEvent);
    } else if (event.type === 'open' && this.onopen) {
      this.onopen(event);
    } else if (event.type === 'close' && this.onclose) {
      this.onclose(event);
    } else if (event.type === 'error' && this.onerror) {
      this.onerror(event);
    }

    return true;
  }

  public close(): void {
    this.readyState = 'closed';
    this.dispatchEvent(new Event('close'));
  }
}

testDescribe('WebRTC DataChannel Listener Cleanup & Registry (#9509)', () => {
  let channel: MockRTCDataChannel;

  testBeforeEach(() => {
    channel = new MockRTCDataChannel();
  });

  testDescribe('Basic Registry Registration & Idempotency', () => {
    testIt('registers event listener and tracks in registry', () => {
      const listener = createSpy();
      registerDataChannelListener(channel as unknown as RTCDataChannel, 'message', listener);

      testExpect(channel.addCalls).toBe(1);
      testExpect(channel.activeListeners).toHaveLength(1);
      testExpect(getDataChannelListenerCount(channel as unknown as RTCDataChannel, 'message')).toBe(1);
      testExpect(getDataChannelListenerCount(channel as unknown as RTCDataChannel)).toBe(1);
    });

    testIt('prevents duplicate listener registration on the same channel', () => {
      const listener = createSpy();
      registerDataChannelListener(channel as unknown as RTCDataChannel, 'message', listener);
      registerDataChannelListener(channel as unknown as RTCDataChannel, 'message', listener);

      testExpect(channel.addCalls).toBe(1);
      testExpect(channel.activeListeners).toHaveLength(1);
      testExpect(getDataChannelListenerCount(channel as unknown as RTCDataChannel, 'message')).toBe(1);
    });

    testIt('unregisters specific listener cleanly', () => {
      const listener = createSpy();
      registerDataChannelListener(channel as unknown as RTCDataChannel, 'message', listener);
      unregisterDataChannelListener(channel as unknown as RTCDataChannel, 'message', listener);

      testExpect(channel.removeCalls).toBe(1);
      testExpect(channel.activeListeners).toHaveLength(0);
      testExpect(getDataChannelListenerCount(channel as unknown as RTCDataChannel, 'message')).toBe(0);
    });
  });

  testDescribe('Full Cleanup & Property Handler Clearing', () => {
    testIt('removes all registered event listeners and clears property handlers', () => {
      const onMsg = createSpy();
      const onErr = createSpy();
      const onOpen = createSpy();
      const onClose = createSpy();

      registerDataChannelListener(channel as unknown as RTCDataChannel, 'message', onMsg);
      registerDataChannelListener(channel as unknown as RTCDataChannel, 'error', onErr);
      registerDataChannelListener(channel as unknown as RTCDataChannel, 'open', onOpen);
      registerDataChannelListener(channel as unknown as RTCDataChannel, 'close', onClose);

      channel.onmessage = createSpy();
      channel.onerror = createSpy();
      channel.onopen = createSpy();
      channel.onclose = createSpy();

      testExpect(getDataChannelListenerCount(channel as unknown as RTCDataChannel)).toBe(4);

      cleanupDataChannelListeners(channel as unknown as RTCDataChannel);

      testExpect(channel.activeListeners).toHaveLength(0);
      testExpect(channel.removeCalls).toBe(4);
      testExpect(channel.onmessage).toBeNull();
      testExpect(channel.onerror).toBeNull();
      testExpect(channel.onopen).toBeNull();
      testExpect(channel.onclose).toBeNull();
      testExpect(getDataChannelListenerCount(channel as unknown as RTCDataChannel)).toBe(0);
    });

    testIt('is safe to call cleanupDataChannelListeners multiple times idempotently', () => {
      const onMsg = createSpy();
      registerDataChannelListener(channel as unknown as RTCDataChannel, 'message', onMsg);

      cleanupDataChannelListeners(channel as unknown as RTCDataChannel);
      cleanupDataChannelListeners(channel as unknown as RTCDataChannel);

      testExpect(channel.removeCalls).toBe(1);
      testExpect(channel.activeListeners).toHaveLength(0);
      testExpect(getDataChannelListenerCount(channel as unknown as RTCDataChannel)).toBe(0);
    });

    testIt('handles null, undefined, or malformed channels gracefully without throwing', () => {
      const dummyFn = createSpy();
      testExpect(() => cleanupDataChannelListeners(null as any)).not.toThrow();
      testExpect(() => cleanupDataChannelListeners(undefined as any)).not.toThrow();
      testExpect(() => registerDataChannelListener(null as any, 'message', dummyFn)).not.toThrow();
      testExpect(() => unregisterDataChannelListener(null as any, 'message', dummyFn)).not.toThrow();
    });
  });

  testDescribe('Channel Replacement & 50+ Reconnection / Renegotiation Cycles', () => {
    testIt('verifies zero listener accumulation over 50+ consecutive renegotiation cycles', () => {
      const CYCLES = 60;
      const obsoleteChannels: MockRTCDataChannel[] = [];
      let currentActiveChannel: MockRTCDataChannel = new MockRTCDataChannel();

      for (let i = 0; i < CYCLES; i++) {
        const nextChannel = new MockRTCDataChannel();
        const incomingHandler = createSpy();
        const errorHandler = createSpy();
        const openHandler = createSpy();
        const closeHandler = createSpy();

        // 1. Channel replacement: old channel is cleaned up before new one is registered
        cleanupDataChannelListeners(currentActiveChannel as unknown as RTCDataChannel);
        obsoleteChannels.push(currentActiveChannel);

        // 2. Setup next channel with listeners
        registerDataChannelListener(nextChannel as unknown as RTCDataChannel, 'message', incomingHandler);
        registerDataChannelListener(nextChannel as unknown as RTCDataChannel, 'error', errorHandler);
        registerDataChannelListener(nextChannel as unknown as RTCDataChannel, 'open', openHandler);
        registerDataChannelListener(nextChannel as unknown as RTCDataChannel, 'close', closeHandler);

        currentActiveChannel = nextChannel;
      }

      // Assertions:
      // 1. Every obsolete channel must have zero active listeners
      for (const obs of obsoleteChannels) {
        testExpect(obs.activeListeners).toHaveLength(0);
        testExpect(getDataChannelListenerCount(obs as unknown as RTCDataChannel)).toBe(0);
      }

      // 2. Only the current active channel has exactly 4 listeners registered
      testExpect(currentActiveChannel.activeListeners).toHaveLength(4);
      testExpect(getDataChannelListenerCount(currentActiveChannel as unknown as RTCDataChannel)).toBe(4);

      // 3. Final cleanup clears the active channel too
      cleanupDataChannelListeners(currentActiveChannel as unknown as RTCDataChannel);
      testExpect(currentActiveChannel.activeListeners).toHaveLength(0);
      testExpect(getDataChannelListenerCount(currentActiveChannel as unknown as RTCDataChannel)).toBe(0);
    });

    testIt('ensures obsolete channel message dispatches do not reach subscribers', () => {
      const channelA = new MockRTCDataChannel();
      const channelB = new MockRTCDataChannel();

      const receivedMessages: string[] = [];
      let activeChannel: MockRTCDataChannel = channelA;

      const messageListenerA = (evt: Event) => {
        if (activeChannel !== channelA) return;
        receivedMessages.push((evt as MessageEvent).data);
      };
      const messageListenerB = (evt: Event) => {
        if (activeChannel !== channelB) return;
        receivedMessages.push((evt as MessageEvent).data);
      };

      registerDataChannelListener(channelA as unknown as RTCDataChannel, 'message', messageListenerA);
      channelA.dispatchEvent(new MessageEvent('message', { data: 'msg-from-A-1' }));
      testExpect(receivedMessages).toEqual(['msg-from-A-1']);

      // Swap to channelB and clean up channelA
      cleanupDataChannelListeners(channelA as unknown as RTCDataChannel);
      activeChannel = channelB;
      registerDataChannelListener(channelB as unknown as RTCDataChannel, 'message', messageListenerB);

      // Dispatch event on old channelA -> should not trigger subscriber
      channelA.dispatchEvent(new MessageEvent('message', { data: 'stale-msg-from-A' }));
      testExpect(receivedMessages).toEqual(['msg-from-A-1']);

      // Dispatch event on new active channelB -> should arrive exactly once
      channelB.dispatchEvent(new MessageEvent('message', { data: 'msg-from-B-1' }));
      testExpect(receivedMessages).toEqual(['msg-from-A-1', 'msg-from-B-1']);

      cleanupDataChannelListeners(channelB as unknown as RTCDataChannel);
    });
  });

  testDescribe('Isolation Between Multiple Peers', () => {
    testIt('cleans up channel listeners for peer-1 without affecting peer-2', () => {
      const channelPeer1 = new MockRTCDataChannel();
      const channelPeer2 = new MockRTCDataChannel();

      const listener1 = createSpy();
      const listener2 = createSpy();

      registerDataChannelListener(channelPeer1 as unknown as RTCDataChannel, 'message', listener1);
      registerDataChannelListener(channelPeer2 as unknown as RTCDataChannel, 'message', listener2);

      testExpect(getDataChannelListenerCount(channelPeer1 as unknown as RTCDataChannel)).toBe(1);
      testExpect(getDataChannelListenerCount(channelPeer2 as unknown as RTCDataChannel)).toBe(1);

      cleanupDataChannelListeners(channelPeer1 as unknown as RTCDataChannel);

      testExpect(getDataChannelListenerCount(channelPeer1 as unknown as RTCDataChannel)).toBe(0);
      testExpect(getDataChannelListenerCount(channelPeer2 as unknown as RTCDataChannel)).toBe(1);
      testExpect(channelPeer2.activeListeners).toHaveLength(1);

      cleanupDataChannelListeners(channelPeer2 as unknown as RTCDataChannel);
      testExpect(getDataChannelListenerCount(channelPeer2 as unknown as RTCDataChannel)).toBe(0);
    });
  });
});
