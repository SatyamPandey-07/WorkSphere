import { WebRTCMesh, isPolitePeer } from '../../../core/network/WebRTCMesh';

describe('WebRTCMesh Lifecycle, Automated ICE Restart & Cleanup', () => {
  let originalRTCPeerConnection: any;

  class MockRTCDataChannel {
    public label: string;
    public binaryType: string = 'arraybuffer';
    public readyState: string = 'open';
    public onmessage: any = null;
    public onopen: any = null;
    public onclose: any = null;
    public onerror: any = null;

    constructor(label: string) {
      this.label = label;
    }

    send(data: any) {}
    close() {
      this.readyState = 'closed';
    }
  }

  class MockRTCPeerConnection {
    public connectionState: string = 'new';
    public iceConnectionState: string = 'new';
    public signalingState: string = 'stable';
    public remoteDescription: any = null;
    public localDescription: any = null;
    public onicecandidate: any = null;
    public oniceconnectionstatechange: any = null;
    public onconnectionstatechange: any = null;
    public ondatachannel: any = null;
    public onnegotiationneeded: any = null;
    public onsignalingstatechange: any = null;
    public ontrack: any = null;
    public restartIceCalled = false;
    public lastOfferOptions: any = null;

    constructor(public config?: any) {}

    createDataChannel(label: string, options?: any) {
      return new MockRTCDataChannel(label);
    }

    restartIce() {
      this.restartIceCalled = true;
    }

    async createOffer(options?: any) {
      this.lastOfferOptions = options;
      return { type: 'offer', sdp: 'mock-offer-sdp' };
    }

    async createAnswer(options?: any) {
      return { type: 'answer', sdp: 'mock-answer-sdp' };
    }

    async setLocalDescription(desc: any) {
      this.localDescription = desc;
    }

    async setRemoteDescription(desc: any) {
      this.remoteDescription = desc;
    }

    async addIceCandidate(candidate: any) {}

    close() {
      this.connectionState = 'closed';
      this.iceConnectionState = 'closed';
    }
  }

  beforeAll(() => {
    originalRTCPeerConnection = (global as any).RTCPeerConnection;
    (global as any).RTCPeerConnection = MockRTCPeerConnection;
  });

  afterAll(() => {
    (global as any).RTCPeerConnection = originalRTCPeerConnection;
  });

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('correctly calculates polite peer tie-breaker deterministically', () => {
    expect(isPolitePeer('peer-a', 'peer-b')).toBe(true);
    expect(isPolitePeer('peer-b', 'peer-a')).toBe(false);
  });

  it('configures custom ICE restart parameters and bounds', () => {
    const mesh = new WebRTCMesh('local-node', null, {
      maxIceRestarts: 5,
      iceRestartBackoffMs: 500,
    });
    expect(mesh.getMaxIceRestarts()).toBe(5);
    mesh.setMaxIceRestarts(2);
    expect(mesh.getMaxIceRestarts()).toBe(2);
  });

  it('cleans up and nullifies all event handlers on peer disconnect to prevent leaks', async () => {
    const mesh = new WebRTCMesh('local-node');
    await mesh.createPeerConnection('remote-peer-1', true);

    const peer = mesh.getPeer('remote-peer-1')!;
    expect(peer).toBeDefined();
    const dataChannel = peer.dataChannel as MockRTCDataChannel;
    const connection = peer.connection as MockRTCPeerConnection;

    expect(dataChannel.onmessage).not.toBeNull();
    expect(dataChannel.onopen).not.toBeNull();
    expect(dataChannel.onclose).not.toBeNull();
    expect(connection.onconnectionstatechange).not.toBeNull();
    expect(connection.oniceconnectionstatechange).not.toBeNull();
    expect(connection.onicecandidate).not.toBeNull();

    mesh.onPeerDisconnect('remote-peer-1');

    expect(dataChannel.onmessage).toBeNull();
    expect(dataChannel.onopen).toBeNull();
    expect(dataChannel.onclose).toBeNull();
    expect(dataChannel.onerror).toBeNull();
    expect(connection.onicecandidate).toBeNull();
    expect(connection.oniceconnectionstatechange).toBeNull();
    expect(connection.onconnectionstatechange).toBeNull();
    expect(connection.ondatachannel).toBeNull();
    expect(connection.onnegotiationneeded).toBeNull();
    expect(connection.onsignalingstatechange).toBeNull();
    expect((connection as any).ontrack).toBeNull();

    expect(mesh.getPeer('remote-peer-1')).toBeUndefined();
  });

  it('releases DataChannel event handlers across 50 sequential peer teardowns', async () => {
    const mesh = new WebRTCMesh('local-node');
    const disconnectedChannels: MockRTCDataChannel[] = [];

    for (let index = 0; index < 50; index++) {
      const peerId = `stress-peer-${index}`;
      await mesh.createPeerConnection(peerId, true);

      const peer = mesh.getPeer(peerId)!;
      const channel = peer.dataChannel as MockRTCDataChannel;
      disconnectedChannels.push(channel);

      expect(channel.onmessage).not.toBeNull();
      expect(channel.onopen).not.toBeNull();
      expect(channel.onclose).not.toBeNull();
      expect(channel.onerror).not.toBeNull();

      mesh.onPeerDisconnect(peerId);

      expect(channel.onmessage).toBeNull();
      expect(channel.onopen).toBeNull();
      expect(channel.onclose).toBeNull();
      expect(channel.onerror).toBeNull();
      expect(mesh.getPeer(peerId)).toBeUndefined();
    }

    expect(mesh.getPeerCount()).toBe(0);
    expect(disconnectedChannels).toHaveLength(50);
    expect(disconnectedChannels.every((channel) =>
      channel.onmessage === null &&
      channel.onopen === null &&
      channel.onclose === null &&
      channel.onerror === null
    )).toBe(true);
  });

  it('triggers automated ICE restart when connection transitions to failed state', async () => {
    const mockSignaling = {
      sendDescription: jest.fn(),
      sendCandidate: jest.fn(),
    };
    const mesh = new WebRTCMesh('local-node', mockSignaling, {
      maxIceRestarts: 3,
      iceRestartBackoffMs: 200,
    });

    await mesh.createPeerConnection('remote-peer-2', true);
    const peer = mesh.getPeer('remote-peer-2')!;
    const connection = peer.connection as MockRTCPeerConnection;

    // Simulate connection failure (iceConnectionState = failed)
    connection.iceConnectionState = 'failed';
    connection.oniceconnectionstatechange();

    // 3000ms threshold timer should be active, but restart offer not yet sent
    expect(peer.status).toBe('connecting');
    expect(peer.iceRestartCount).toBe(0);

    // Advance 3000ms to trigger recovery schedule
    jest.advanceTimersByTime(3000);

    expect(peer.status).toBe('reconnecting');
    expect(peer.iceRestartCount).toBe(1);

    // Advance backoff timer (200ms)
    jest.advanceTimersByTime(200);
    await Promise.resolve();

    // Verify negotiate was dispatched with iceRestart: true
    expect(connection.restartIceCalled).toBe(true);
    expect(connection.lastOfferOptions).toEqual({ iceRestart: true });
    expect(mockSignaling.sendDescription).toHaveBeenCalled();
  });

  it('handles disconnected state by initiating delayed recovery without 3000ms failure threshold', async () => {
    const mockSignaling = {
      sendDescription: jest.fn(),
      sendCandidate: jest.fn(),
    };
    const mesh = new WebRTCMesh('local-node', mockSignaling, {
      maxIceRestarts: 3,
      iceRestartBackoffMs: 200,
    });

    await mesh.createPeerConnection('remote-peer-disc', true);
    const peer = mesh.getPeer('remote-peer-disc')!;
    const connection = peer.connection as MockRTCPeerConnection;

    connection.iceConnectionState = 'disconnected';
    connection.oniceconnectionstatechange();

    // Immediately schedules backoff
    expect(peer.status).toBe('reconnecting');
    expect(peer.iceRestartCount).toBe(1);

    jest.advanceTimersByTime(200);
    await Promise.resolve();

    expect(connection.lastOfferOptions).toEqual({ iceRestart: true });
    expect(mockSignaling.sendDescription).toHaveBeenCalled();
  });

  it('cancels pending recovery timers when connection recovers before timeout', async () => {
    const mockSignaling = {
      sendDescription: jest.fn(),
      sendCandidate: jest.fn(),
    };
    const mesh = new WebRTCMesh('local-node', mockSignaling, {
      maxIceRestarts: 3,
      iceRestartBackoffMs: 200,
    });

    await mesh.createPeerConnection('remote-peer-recov', true);
    const peer = mesh.getPeer('remote-peer-recov')!;
    const connection = peer.connection as MockRTCPeerConnection;

    connection.iceConnectionState = 'failed';
    connection.oniceconnectionstatechange();

    expect(peer.recoveryTimer).not.toBeNull();

    // Recover before 3000ms
    jest.advanceTimersByTime(1500);
    connection.iceConnectionState = 'connected';
    connection.oniceconnectionstatechange();

    expect(peer.recoveryTimer).toBeNull();
    expect(peer.iceRestartCount).toBe(0);
    expect(peer.status).toBe('connected');

    // Advance past remaining time and verify no restart occurred
    jest.advanceTimersByTime(5000);
    expect(connection.restartIceCalled).toBe(false);
  });

  it('resets restart count when connection successfully recovers to connected', async () => {
    const mesh = new WebRTCMesh('local-node', null, { maxIceRestarts: 3 });
    const connectedSpy = jest.fn();
    mesh.onPeerConnected(connectedSpy);

    await mesh.createPeerConnection('remote-peer-3', true);
    const peer = mesh.getPeer('remote-peer-3')!;
    const connection = peer.connection as MockRTCPeerConnection;

    // Transition to failed
    connection.iceConnectionState = 'failed';
    connection.oniceconnectionstatechange();
    jest.advanceTimersByTime(3000);
    expect(peer.iceRestartCount).toBe(1);
    expect(peer.status).toBe('reconnecting');

    // Connection recovers
    connection.iceConnectionState = 'connected';
    connection.oniceconnectionstatechange();
    expect(peer.status).toBe('connected');
    expect(peer.iceRestartCount).toBe(0);
    expect(connectedSpy).toHaveBeenCalledWith('remote-peer-3');
  });

  it('tears down peer when maximum ICE restart attempts are exceeded', async () => {
    const mesh = new WebRTCMesh('local-node', null, {
      maxIceRestarts: 2,
      iceRestartBackoffMs: 100,
    });

    await mesh.createPeerConnection('remote-peer-4', true);
    const peer = mesh.getPeer('remote-peer-4')!;
    const connection = peer.connection as MockRTCPeerConnection;

    // Attempt 1
    connection.iceConnectionState = 'failed';
    connection.oniceconnectionstatechange();
    jest.advanceTimersByTime(3000); // threshold
    expect(peer.iceRestartCount).toBe(1);
    expect(peer.status).toBe('reconnecting');
    jest.advanceTimersByTime(100); // backoff
    await Promise.resolve();

    // Settle answer to return signalingState to stable
    await mesh.handleRemoteAnswer('remote-peer-4', { type: 'answer', sdp: 'ans-1' });

    // Attempt 2
    connection.iceConnectionState = 'failed';
    connection.oniceconnectionstatechange();
    jest.advanceTimersByTime(3000); // threshold
    expect(peer.iceRestartCount).toBe(2);
    jest.advanceTimersByTime(200); // exponential backoff 100 * 2^1 = 200
    await Promise.resolve();

    // Settle answer
    await mesh.handleRemoteAnswer('remote-peer-4', { type: 'answer', sdp: 'ans-2' });

    // Attempt 3 (exceeds maxIceRestarts of 2)
    connection.iceConnectionState = 'failed';
    connection.oniceconnectionstatechange();
    jest.advanceTimersByTime(3000);
    await Promise.resolve();

    // Peer should now be fully disconnected and removed
    expect(mesh.getPeer('remote-peer-4')).toBeUndefined();
  });

  it('exponentially increases backoff delay on consecutive failures', async () => {
    const mockSignaling = {
      sendDescription: jest.fn(),
      sendCandidate: jest.fn(),
    };
    const mesh = new WebRTCMesh('local-node', mockSignaling, {
      maxIceRestarts: 4,
      iceRestartBackoffMs: 500,
    });

    await mesh.createPeerConnection('remote-peer-backoff', true);
    const peer = mesh.getPeer('remote-peer-backoff')!;
    const connection = peer.connection as MockRTCPeerConnection;

    // Failure 1: backoff = 500 * 2^0 = 500ms
    connection.iceConnectionState = 'disconnected';
    connection.oniceconnectionstatechange();
    expect(peer.iceRestartCount).toBe(1);

    jest.advanceTimersByTime(499);
    expect(connection.lastOfferOptions).toBeUndefined();
    jest.advanceTimersByTime(1);
    await Promise.resolve();
    expect(connection.lastOfferOptions).toEqual({ iceRestart: true });

    // Settle answer so signalingState returns to stable
    await mesh.handleRemoteAnswer('remote-peer-backoff', { type: 'answer', sdp: 'ans-backoff-1' });
    connection.lastOfferOptions = undefined;

    // Failure 2: backoff = 500 * 2^1 = 1000ms
    connection.iceConnectionState = 'disconnected';
    connection.oniceconnectionstatechange();
    expect(peer.iceRestartCount).toBe(2);

    jest.advanceTimersByTime(999);
    expect(connection.lastOfferOptions).toBeUndefined();
    jest.advanceTimersByTime(1);
    await Promise.resolve();
    expect(connection.lastOfferOptions).toEqual({ iceRestart: true });
  });

  it('prevents overlapping or simultaneous restart attempts for the same peer', async () => {
    const mockSignaling = {
      sendDescription: jest.fn(),
      sendCandidate: jest.fn(),
    };
    const mesh = new WebRTCMesh('local-node', mockSignaling, {
      maxIceRestarts: 3,
      iceRestartBackoffMs: 500,
    });

    await mesh.createPeerConnection('remote-peer-overlap', true);
    const peer = mesh.getPeer('remote-peer-overlap')!;
    const connection = peer.connection as MockRTCPeerConnection;

    // Trigger disconnected
    connection.iceConnectionState = 'disconnected';
    connection.oniceconnectionstatechange();
    expect(peer.iceRestartCount).toBe(1);

    // Trigger again while first timer is pending - should not increment or schedule duplicate
    connection.oniceconnectionstatechange();
    expect(peer.iceRestartCount).toBe(1);

    // Advance timer to fire the scheduled restart
    jest.advanceTimersByTime(500);
    await Promise.resolve();
    expect(connection.lastOfferOptions).toEqual({ iceRestart: true });
  });

  it('does not attempt ICE restart if peer connection is already closed', async () => {
    const mesh = new WebRTCMesh('local-node', null, { maxIceRestarts: 3 });
    await mesh.createPeerConnection('peer-closed', true);
    const peer = mesh.getPeer('peer-closed')!;
    const connection = peer.connection as MockRTCPeerConnection;

    connection.close();
    connection.oniceconnectionstatechange();

    await mesh.restartIce('peer-closed');
    expect(connection.lastOfferOptions).toBeUndefined();
  });

  it('allows polite peer to yield on offer collision during ICE restart', async () => {
    const mockSignaling = {
      sendDescription: jest.fn(),
      sendCandidate: jest.fn(),
    };
    // local-a is polite with respect to remote-b ('local-a' < 'remote-b')
    const mesh = new WebRTCMesh('local-a', mockSignaling);
    await mesh.createPeerConnection('remote-b', false);

    const peer = mesh.getPeer('remote-b')!;
    const connection = peer.connection as MockRTCPeerConnection;
    expect(peer.polite).toBe(true);

    // Initiate restart offer locally
    peer.makingOffer = true;
    peer.isRestartingIce = true;
    connection.signalingState = 'have-local-offer';

    // Incoming remote offer arrives (collision)
    await mesh.handleRemoteOffer('remote-b', { type: 'offer', sdp: 'remote-restart-offer' });

    // Polite peer should accept remote offer, creating answer
    expect(connection.remoteDescription).toEqual({ type: 'offer', sdp: 'remote-restart-offer' });
    expect(connection.localDescription).toEqual({ type: 'answer', sdp: 'mock-answer-sdp' });
    expect(mockSignaling.sendDescription).toHaveBeenCalled();
  });

  it('causes impolite peer to ignore colliding offer during ICE restart', async () => {
    const mockSignaling = {
      sendDescription: jest.fn(),
      sendCandidate: jest.fn(),
    };
    // peer-z is impolite with respect to peer-a ('peer-z' > 'peer-a')
    const mesh = new WebRTCMesh('peer-z', mockSignaling);
    await mesh.createPeerConnection('peer-a', false);

    const peer = mesh.getPeer('peer-a')!;
    const connection = peer.connection as MockRTCPeerConnection;
    expect(peer.polite).toBe(false);

    // Initiate restart offer locally
    peer.makingOffer = true;
    peer.isRestartingIce = true;
    connection.signalingState = 'have-local-offer';

    // Incoming remote offer arrives (collision)
    await mesh.handleRemoteOffer('peer-a', { type: 'offer', sdp: 'remote-colliding-offer' });

    // Impolite peer should ignore remote offer
    expect(peer.ignoreOffer).toBe(true);
    expect(connection.remoteDescription).toBeNull();
  });

  it('cleans up all peers and timers upon closeAll()', async () => {
    const mesh = new WebRTCMesh('local-node', null, { maxIceRestarts: 3 });
    await mesh.createPeerConnection('peer-1', true);
    await mesh.createPeerConnection('peer-2', true);

    const peer1 = mesh.getPeer('peer-1')!;
    const conn1 = peer1.connection as MockRTCPeerConnection;
    conn1.iceConnectionState = 'disconnected';
    conn1.oniceconnectionstatechange();
    expect(peer1.iceRestartTimer).not.toBeNull();

    mesh.closeAll();

    expect(mesh.getPeer('peer-1')).toBeUndefined();
    expect(mesh.getPeer('peer-2')).toBeUndefined();
  });
});
