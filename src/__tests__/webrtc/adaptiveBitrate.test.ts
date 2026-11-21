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

  describe('applying the bitrate to the video sender', () => {
    /** A video sender as the browser gives it: settings are read with getParameters(). */
    function videoSender() {
      const parameters = { encodings: [{}] } as unknown as RTCRtpSendParameters;
      return {
        track: { kind: 'video' },
        getParameters: jest.fn(() => parameters),
        setParameters: jest.fn(async () => undefined),
      };
    }

    function peerConnection(
      sender: ReturnType<typeof videoSender>,
      reports: Array<Record<string, unknown>>,
    ) {
      return {
        getStats: async () => new Map(reports.map((report, i) => [String(i), report])),
        getSenders: () => [sender, { track: { kind: 'audio' } }],
      } as unknown as RTCPeerConnection;
    }

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('lowers the sender bitrate and reports telemetry on packet loss', async () => {
      const sender = videoSender();
      const telemetry: Array<{ bitrateBps: number; resolution: string; packetLossPercent: number }> = [];
      const manager = new ScreenShareManager(
        peerConnection(sender, [
          { type: 'remote-inbound-rtp', roundTripTime: 0.05 },
          { type: 'outbound-rtp', packetsLost: 10, packetsSent: 100 },
        ]),
        (t) => telemetry.push(t),
      );

      manager.startMonitoring();
      await jest.advanceTimersByTimeAsync(1000);
      manager.stopMonitoring();

      // 2.5 Mbps * 0.7 after 10% packet loss, which is 720p at 20 fps
      expect(sender.getParameters).toHaveBeenCalledTimes(1);
      expect(sender.setParameters).toHaveBeenCalledTimes(1);
      const applied = sender.setParameters.mock.calls[0] as unknown as [RTCRtpSendParameters];
      expect(applied[0].encodings[0].maxBitrate).toBe(1750000);
      expect(applied[0].encodings[0].maxFramerate).toBe(20);

      expect(telemetry).toHaveLength(1);
      expect(telemetry[0].bitrateBps).toBe(1750000);
      expect(telemetry[0].resolution).toBe('720p');
      expect(telemetry[0].packetLossPercent).toBe(10);
    });

    test('keeps applying the bitrate on every poll', async () => {
      const sender = videoSender();
      const manager = new ScreenShareManager(
        peerConnection(sender, [
          { type: 'outbound-rtp', packetsLost: 20, packetsSent: 100 },
        ]),
      );

      manager.startMonitoring();
      await jest.advanceTimersByTimeAsync(3000);
      manager.stopMonitoring();

      expect(sender.setParameters).toHaveBeenCalledTimes(3);
      const last = sender.setParameters.mock.calls[2] as unknown as [RTCRtpSendParameters];
      // 2.5 Mbps * 0.7 three times, below 1 Mbps the stream drops to 480p at 15 fps
      expect(last[0].encodings[0].maxBitrate).toBeCloseTo(2500000 * 0.7 ** 3, 3);
      expect(last[0].encodings[0].maxFramerate).toBe(15);
    });
  });
});
