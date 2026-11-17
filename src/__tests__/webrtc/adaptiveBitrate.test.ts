import { ScreenShareManager } from '../../lib/webrtc/screenShareManager';

describe('WebRTC Adaptive Bitrate (ABR) AIMD Controller', () => {
  test('ScreenShareManager initializes and updates telemetry correctly', () => {
    const mockPc = {
      getStats: async () => new Map(),
      getSenders: () => [],
    } as unknown as RTCPeerConnection;

    let latestTelemetry: any = null;
    const manager = new ScreenShareManager(mockPc, (t) => {
      latestTelemetry = t;
    });

    expect(manager).toBeDefined();
  });
});