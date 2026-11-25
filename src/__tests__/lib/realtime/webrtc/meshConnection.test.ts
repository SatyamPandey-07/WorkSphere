import {
  ICE_RESTART_TIMEOUT_MS,
  MeshPeerConnection,
} from '@/lib/realtime/webrtc/meshConnection';

interface MockRtcPeer {
  iceConnectionState: RTCIceConnectionState;
  onicecandidate: ((ev: { candidate: RTCIceCandidate | null }) => void) | null;
  oniceconnectionstatechange: (() => void) | null;
  restartIce: jest.Mock;
  createOffer: jest.Mock;
  setLocalDescription: jest.Mock;
  close: jest.Mock;
}

describe('MeshPeerConnection ICE restart & TURN fallback', () => {
  let createdPeers: MockRtcPeer[];

  beforeEach(() => {
    jest.useFakeTimers();
    createdPeers = [];

    const PeerConstructor = jest.fn().mockImplementation(() => {
      const instance: MockRtcPeer = {
        iceConnectionState: 'new',
        onicecandidate: null,
        oniceconnectionstatechange: null,
        restartIce: jest.fn(),
        createOffer: jest.fn().mockResolvedValue({ type: 'offer', sdp: 'v=0' }),
        setLocalDescription: jest.fn().mockResolvedValue(undefined),
        close: jest.fn(),
      };
      createdPeers.push(instance);
      return instance;
    });

    (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection =
      PeerConstructor;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('triggers ICE restart on disconnect and cancels timeout if connected within 10s', async () => {
    const onSendOffer = jest.fn();
    const mesh = new MeshPeerConnection({
      peerId: 'peer-2',
      onSendOffer,
    });

    const firstPeer = createdPeers[0];
    firstPeer.iceConnectionState = 'disconnected';
    firstPeer.oniceconnectionstatechange?.();

    await Promise.resolve();
    expect(firstPeer.restartIce).toHaveBeenCalledTimes(1);
    expect(onSendOffer).toHaveBeenCalledWith(
      'peer-2',
      expect.objectContaining({ type: 'offer' }),
      { forceRelay: false }
    );

    jest.advanceTimersByTime(4_000);
    firstPeer.iceConnectionState = 'connected';
    firstPeer.oniceconnectionstatechange?.();

    jest.advanceTimersByTime(ICE_RESTART_TIMEOUT_MS);
    expect(firstPeer.close).not.toHaveBeenCalled();
    expect(createdPeers).toHaveLength(1);

    mesh.close();
  });

  it('closes stale peer connection after 10s timeout and initiates TURN relay offer', async () => {
    const onSendOffer = jest.fn();
    const states: string[] = [];

    const mesh = new MeshPeerConnection({
      peerId: 'peer-3',
      onSendOffer,
      onStateChange: (_id, state) => states.push(state),
    });

    const stalePeer = createdPeers[0];
    stalePeer.iceConnectionState = 'disconnected';
    stalePeer.oniceconnectionstatechange?.();

    await jest.advanceTimersByTimeAsync(ICE_RESTART_TIMEOUT_MS);

    expect(stalePeer.close).toHaveBeenCalledTimes(1);
    expect(states).toContain('relay_reconnecting');
    expect(createdPeers).toHaveLength(2);
    expect(onSendOffer).toHaveBeenLastCalledWith(
      'peer-3',
      expect.objectContaining({ type: 'offer' }),
      { forceRelay: true }
    );

    mesh.close();
  });
});
