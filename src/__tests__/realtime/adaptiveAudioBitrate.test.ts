import {
  AdaptiveAudioBitrateController,
  MAX_AUDIO_BITRATE_BPS,
  MIN_AUDIO_BITRATE_BPS,
  THROTTLED_AUDIO_BITRATE_BPS,
  type AdaptiveAudioTelemetryEvent,
} from '@/lib/realtime/webrtc/meshConnection';

function createStatsReport(entries: Record<string, unknown>[]) {
  return {
    forEach(cb: (value: Record<string, unknown>) => void) {
      entries.forEach(cb);
    },
  } as unknown as RTCStatsReport;
}

describe('AdaptiveAudioBitrateController', () => {
  it('throttles audio maxBitrate under packet loss and emits telemetry without renegotiating', async () => {
    const telemetry: AdaptiveAudioTelemetryEvent[] = [];
    const setParameters = jest.fn().mockResolvedValue(undefined);
    const getParameters = jest.fn().mockReturnValue({
      encodings: [{ maxBitrate: MAX_AUDIO_BITRATE_BPS }],
    });

    const audioSender = {
      track: { kind: 'audio' },
      getParameters,
      setParameters,
    } as unknown as RTCRtpSender;

    let reportIndex = 0;
    const reports = [
      createStatsReport([
        { type: 'outbound-rtp', kind: 'audio', packetsSent: 100 },
        { type: 'remote-inbound-rtp', packetsLost: 0, roundTripTime: 0.04 },
      ]),
      createStatsReport([
        { type: 'outbound-rtp', kind: 'audio', packetsSent: 190 },
        { type: 'remote-inbound-rtp', packetsLost: 10, roundTripTime: 0.06 },
      ]),
    ];

    const mockPc = {
      getSenders: () => [audioSender],
      getStats: jest.fn(() => Promise.resolve(reports[reportIndex++])),
    };

    const controller = new AdaptiveAudioBitrateController('peer-cafe-1', {
      onTelemetry: (evt) => telemetry.push(evt),
    });

    await controller.sampleAndAdapt(mockPc, 1_000);
    const bitrateAfterLoss = await controller.sampleAndAdapt(mockPc, 3_000);

    expect(bitrateAfterLoss).toBe(THROTTLED_AUDIO_BITRATE_BPS);
    expect(setParameters).toHaveBeenCalledTimes(1);
    expect(setParameters).toHaveBeenCalledWith(
      expect.objectContaining({
        encodings: [expect.objectContaining({ maxBitrate: THROTTLED_AUDIO_BITRATE_BPS })],
      })
    );
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0].nextBitrateBps).toBe(THROTTLED_AUDIO_BITRATE_BPS);
  });

  it('drops to 16 kbps under severe loss and recovers toward 64 kbps when link improves', async () => {
    const setParameters = jest.fn().mockResolvedValue(undefined);
    const getParameters = jest.fn().mockReturnValue({
      encodings: [{ maxBitrate: MAX_AUDIO_BITRATE_BPS }],
    });
    const audioSender = {
      track: { kind: 'audio' },
      getParameters,
      setParameters,
    } as unknown as RTCRtpSender;

    let step = 0;
    const reports = [
      createStatsReport([
        { type: 'outbound-rtp', kind: 'audio', packetsSent: 100 },
        { type: 'remote-inbound-rtp', packetsLost: 0, roundTripTime: 0.05 },
      ]),
      createStatsReport([
        { type: 'outbound-rtp', kind: 'audio', packetsSent: 180 },
        { type: 'remote-inbound-rtp', packetsLost: 20, roundTripTime: 0.14 },
      ]),
      createStatsReport([
        { type: 'outbound-rtp', kind: 'audio', packetsSent: 380 },
        { type: 'remote-inbound-rtp', packetsLost: 20, roundTripTime: 0.04 },
      ]),
    ];

    const mockPc = {
      getSenders: () => [audioSender],
      getStats: jest.fn(() => Promise.resolve(reports[step++])),
    };

    const controller = new AdaptiveAudioBitrateController('peer-2');
    await controller.sampleAndAdapt(mockPc, 1_000);
    expect(await controller.sampleAndAdapt(mockPc, 3_000)).toBe(MIN_AUDIO_BITRATE_BPS);
    expect(await controller.sampleAndAdapt(mockPc, 7_500)).toBe(MAX_AUDIO_BITRATE_BPS);
  });
});