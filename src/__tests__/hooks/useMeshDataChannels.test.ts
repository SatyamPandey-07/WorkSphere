import { act, renderHook } from '@testing-library/react';
import {
  useMeshDataChannels,
  type PeerConnectionLike,
  type SignalingChannelLike,
} from '@/hooks/useMeshDataChannels';

function createMockPeerConnection(): PeerConnectionLike {
  const pc: PeerConnectionLike = {
    iceConnectionState: 'connected',
    oniceconnectionstatechange: null,
    restartIce: jest.fn(),
    createOffer: jest.fn().mockResolvedValue({
      type: 'offer',
      sdp: 'v=0\r\nice-restart-offer\r\n',
    }),
    setLocalDescription: jest.fn().mockResolvedValue(undefined),
    close: jest.fn(),
  };
  return pc;
}

describe('useMeshDataChannels ICE restart on failed state', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('triggers restartIce and creates offer with iceRestart: true on failed ICE state', async () => {
    const pc = createMockPeerConnection();
    const sentMessages: Array<string | Record<string, unknown>> = [];
    const signaling: SignalingChannelLike = {
      send: (data) => sentMessages.push(data),
    };
    const onSignalOffer = jest.fn();

    const { result } = renderHook(() =>
      useMeshDataChannels({
        peerId: 'peer-nomad-1',
        peerConnection: pc,
        signaling,
        maxRestarts: 3,
        baseBackoffMs: 100,
        onSignalOffer,
      })
    );

    act(() => {
      pc.iceConnectionState = 'failed';
      pc.oniceconnectionstatechange?.call(pc, new Event('iceconnectionstatechange'));
    });

    expect(result.current.restartAttempts).toBe(1);

    await act(async () => {
      jest.advanceTimersByTime(100);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(pc.restartIce).toHaveBeenCalledTimes(1);
    expect(pc.createOffer).toHaveBeenCalledWith({ iceRestart: true });
    expect(pc.setLocalDescription).toHaveBeenCalledTimes(1);
    expect(onSignalOffer).toHaveBeenCalledWith(
      'peer-nomad-1',
      expect.objectContaining({ type: 'offer' })
    );
    expect(sentMessages).toHaveLength(1);
    expect(String(sentMessages[0])).toContain('ICE_RESTART_OFFER');
  });

  it('stops after maxRestarts = 3 and marks connection terminated', async () => {
    const pc = createMockPeerConnection();
    const onConnectionTerminated = jest.fn();

    const { result } = renderHook(() =>
      useMeshDataChannels({
        peerId: 'peer-drop-1',
        peerConnection: pc,
        maxRestarts: 3,
        baseBackoffMs: 50,
        onConnectionTerminated,
      })
    );

    for (let i = 1; i <= 4; i++) {
      act(() => {
        pc.iceConnectionState = 'failed';
        pc.oniceconnectionstatechange?.call(pc, new Event('iceconnectionstatechange'));
      });

      await act(async () => {
        jest.advanceTimersByTime(500);
        await Promise.resolve();
        await Promise.resolve();
      });
    }

    expect(result.current.restartAttempts).toBe(3);
    expect(result.current.isTerminated).toBe(true);
    expect(onConnectionTerminated).toHaveBeenCalledWith('peer-drop-1', 3);
  });
});