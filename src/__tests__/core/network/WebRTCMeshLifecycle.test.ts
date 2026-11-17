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
    public signalingState: string = 'stable';
    public remoteDescription: any = null;
    public localDescription: any = null;
    public onicecandidate: any = null;
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
    expect(connection.onicecandidate).not.toBeNull();

    mesh.onPeerDisconnect('remote-peer-1');

    expect(dataChannel.onmessage).toBeNull();
    expect(dataChannel.onopen).toBeNull();
    expect(dataChannel.onclose).toBeNull();
    expect(dataChannel.onerror).toBeNull();
    expect(connection.onicecandidate).toBeNull();
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

    // Simulate connection failure
    connection.connectionState = 'failed';
    connection.onconnectionstatechange();

    expect(peer.status).toBe('reconnecting');
    expect(peer.iceRestartCount).toBe(1);

    // Advance timer to trigger backoff restart
    jest.advanceTimersByTime(300);

    // Verify negotiate was dispatched with iceRestart: true
    expect(connection.restartIceCalled).toBe(true);
    expect(connection.lastOfferOptions).toEqual({ iceRestart: true });
    expect(mockSignaling.sendDescription).toHaveBeenCalled();
  });

  it('resets restart count when connection successfully recovers to connected', async () => {
    const mesh = new WebRTCMesh('local-node', null, { maxIceRestarts: 3 });
    const connectedSpy = jest.fn();
    mesh.onPeerConnected(connectedSpy);

    await mesh.createPeerConnection('remote-peer-3', true);
    const peer = mesh.getPeer('remote-peer-3')!;
    const connection = peer.connection as MockRTCPeerConnection;

    // Transition to failed
    connection.connectionState = 'failed';
    connection.onconnectionstatechange();
    expect(peer.iceRestartCount).toBe(1);
    expect(peer.status).toBe('reconnecting');

    // Connection recovers
    connection.connectionState = 'connected';
    connection.onconnectionstatechange();
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
    connection.connectionState = 'failed';
    connection.onconnectionstatechange();
    expect(peer.iceRestartCount).toBe(1);
    expect(peer.status).toBe('reconnecting');

    // Attempt 2
    connection.connectionState = 'failed';
    connection.onconnectionstatechange();
    expect(peer.iceRestartCount).toBe(2);

    // Attempt 3 (exceeds maxIceRestarts of 2)
    connection.connectionState = 'failed';
    connection.onconnectionstatechange();

    // Peer should now be fully disconnected and removed
    expect(mesh.getPeer('remote-peer-4')).toBeUndefined();
  });

  it('cleans up all peers and timers upon closeAll()', async () => {
    const mesh = new WebRTCMesh('local-node', null, { maxIceRestarts: 3 });
    await mesh.createPeerConnection('peer-1', true);
    await mesh.createPeerConnection('peer-2', true);

    const peer1 = mesh.getPeer('peer-1')!;
    const conn1 = peer1.connection as MockRTCPeerConnection;
    conn1.connectionState = 'failed';
    conn1.onconnectionstatechange();
    expect(peer1.iceRestartTimer).not.toBeNull();

    mesh.closeAll();

    expect(mesh.getPeer('peer-1')).toBeUndefined();
    expect(mesh.getPeer('peer-2')).toBeUndefined();
  });
});
