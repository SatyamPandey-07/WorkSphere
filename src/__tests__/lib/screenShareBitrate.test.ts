import {
  pickBitrateTier,
  readNetworkHints,
  adaptVideoBitrate,
} from "@/lib/screenShareBitrate";

describe("pickBitrateTier", () => {
  it("stays high on a healthy link", () => {
    expect(
      pickBitrateTier({
        rttMs: 40,
        packetsLost: 0,
        packetsSent: 100,
        jitterMs: 5,
      }),
    ).toEqual({
      maxBitrate: 2_500_000,
      audioMaxBitrate: 64_000,
      label: "high",
    });
  });

  it("drops to medium when rtt or jitter climbs", () => {
    expect(
      pickBitrateTier({ rttMs: 150, packetsLost: 0, packetsSent: 100 }).label,
    ).toBe("medium");

    expect(
      pickBitrateTier({
        rttMs: 40,
        packetsLost: 0,
        packetsSent: 100,
        jitterMs: 25,
      }).label,
    ).toBe("medium");
  });

  it("drops to low on packet loss or severe jitter", () => {
    expect(
      pickBitrateTier({ rttMs: 50, packetsLost: 20, packetsSent: 100 }).label,
    ).toBe("low");

    expect(
      pickBitrateTier({
        rttMs: 40,
        packetsLost: 0,
        packetsSent: 100,
        jitterMs: 60,
      }).label,
    ).toBe("low");
  });
});

describe("readNetworkHints", () => {
  it("pulls rtt, jitter, and outbound video/audio counters from stats", () => {
    const rows = [
      {
        type: "candidate-pair",
        state: "succeeded",
        currentRoundTripTime: 0.08,
      },
      {
        type: "remote-inbound-rtp",
        jitter: 0.025,
        packetsLost: 2,
        roundTripTime: 0.085,
      },
      {
        type: "outbound-rtp",
        kind: "video",
        packetsSent: 200,
      },
    ];

    const report = {
      forEach(cb: (stat: (typeof rows)[number]) => void) {
        rows.forEach(cb);
      },
    } as unknown as RTCStatsReport;

    expect(readNetworkHints(report)).toEqual({
      rttMs: 85,
      packetsLost: 2,
      packetsSent: 200,
      jitterMs: 25,
    });
  });
});

describe("adaptVideoBitrate", () => {
  it("adaptively adjusts maxBitrate for both video and audio senders", async () => {
    const videoSetParams = jest.fn().mockResolvedValue(undefined);
    const audioSetParams = jest.fn().mockResolvedValue(undefined);

    const videoSender = {
      track: { kind: "video" },
      getParameters: jest.fn().mockReturnValue({ encodings: [{}] }),
      setParameters: videoSetParams,
    };

    const audioSender = {
      track: { kind: "audio" },
      getParameters: jest.fn().mockReturnValue({ encodings: [{}] }),
      setParameters: audioSetParams,
    };

    const mockReport = [
      { type: "candidate-pair", state: "succeeded", currentRoundTripTime: 0.3 }, // Poor RTT (300ms)
    ];

    const pc = {
      getSenders: () => [videoSender, audioSender],
      getStats: jest.fn().mockResolvedValue({
        forEach: (cb: any) => mockReport.forEach(cb),
      }),
    } as unknown as RTCPeerConnection;

    const tier = await adaptVideoBitrate(pc);

    expect(tier?.label).toBe("low");
    expect(videoSender.getParameters().encodings[0].maxBitrate).toBe(400_000);
    expect(audioSender.getParameters().encodings[0].maxBitrate).toBe(16_000);
    expect(videoSetParams).toHaveBeenCalled();
    expect(audioSetParams).toHaveBeenCalled();
  });
});
