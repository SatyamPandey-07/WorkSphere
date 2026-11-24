import { WebRtcTrackController } from '@/lib/realtime/webrtcTrackController';

describe('WebRtcTrackController', () => {
  it('serializes overlapping renegotiation requests into queued_renegotiation and returns to stable', async () => {
    let resolveFirst!: () => void;
    let callCount = 0;
    const seenReasons: string[] = [];

    const controller = new WebRtcTrackController({
      performNegotiation: (reason) => {
        callCount += 1;
        seenReasons.push(reason);
        if (callCount === 1) {
          return new Promise<void>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve();
      },
    });

    const firstReq = controller.requestRenegotiation('start-screen');
    expect(controller.getNegotiationState()).toBe('negotiating');

    const secondReq = controller.requestRenegotiation('stop-screen');
    expect(controller.getNegotiationState()).toBe('queued_renegotiation');

    resolveFirst();
    await Promise.all([firstReq, secondReq]);

    expect(callCount).toBe(2);
    expect(seenReasons).toEqual(['start-screen', 'stop-screen']);
    expect(controller.getNegotiationState()).toBe('stable');
  });

  it('tracks mic, camera, and screen-share states independently and falls back cleanly on screen error or stop', () => {
    const stopScreen = jest.fn();
    const stopCam = jest.fn();
    const stopMic = jest.fn();

    const controller = new WebRtcTrackController({
      performNegotiation: jest.fn().mockResolvedValue(undefined),
    });

    controller.setMicTrack({ id: 'mic-1', enabled: true, readyState: 'live', stop: stopMic });
    controller.setCameraTrack({ id: 'cam-1', enabled: true, readyState: 'live', stop: stopCam });
    controller.startScreenShare({
      id: 'scr-1',
      enabled: true,
      readyState: 'live',
      stop: stopScreen,
    });

    let snap = controller.getSnapshot();
    expect(snap.micActive).toBe(true);
    expect(snap.cameraActive).toBe(true);
    expect(snap.screenShareActive).toBe(true);
    expect(snap.activeTrackIds).toEqual(['mic-1', 'cam-1', 'scr-1']);

    snap = controller.handleScreenShareFallback('Permission denied by user');
    expect(stopScreen).toHaveBeenCalledTimes(1);
    expect(snap.screenShareActive).toBe(false);
    expect(snap.fallbackToMediaOnly).toBe(true);
    expect(snap.micActive).toBe(true);
    expect(snap.cameraActive).toBe(true);
    expect(snap.activeTrackIds).toEqual(['mic-1', 'cam-1']);
    expect(snap.lastError).toBe('Permission denied by user');
  });

  it('cleans up ended tracks automatically on snapshot', () => {
    const controller = new WebRtcTrackController({
      performNegotiation: jest.fn().mockResolvedValue(undefined),
    });

    const camTrack = { id: 'cam-ended', enabled: true, readyState: 'live' as const };
    controller.setCameraTrack(camTrack);
    expect(controller.getSnapshot().cameraActive).toBe(true);

    camTrack.readyState = 'ended';
    const nextSnap = controller.getSnapshot();
    expect(nextSnap.cameraActive).toBe(false);
    expect(nextSnap.activeTrackIds).toEqual([]);
  });
});
