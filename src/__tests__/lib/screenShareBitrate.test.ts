import { pickBitrateTier, readNetworkHints } from "@/lib/screenShareBitrate";

describe("pickBitrateTier", () => {
  it("stays high on a healthy link", () => {
    expect(
      pickBitrateTier({ rttMs: 40, packetsLost: 0, packetsSent: 100 }),
    ).toEqual({
      maxBitrate: 2_500_000,
      label: "high",
    });
  });

  it("drops to medium when rtt climbs", () => {
    expect(
      pickBitrateTier({ rttMs: 150, packetsLost: 0, packetsSent: 100 }).label,
    ).toBe("medium");
  });

  it("drops to low on packet loss", () => {
    expect(
      pickBitrateTier({ rttMs: 50, packetsLost: 20, packetsSent: 100 }).label,
    ).toBe("low");
  });
});

describe("readNetworkHints", () => {
  it("pulls rtt and outbound video counters from stats", () => {
    const rows = [
      {
        type: "candidate-pair",
        state: "succeeded",
        currentRoundTripTime: 0.08,
      },
      {
        type: "outbound-rtp",
        kind: "video",
        packetsLost: 2,
        packetsSent: 200,
      },
    ];

    const report = {
      forEach(cb: (stat: (typeof rows)[number]) => void) {
        rows.forEach(cb);
      },
    } as unknown as RTCStatsReport;

    expect(readNetworkHints(report)).toEqual({
      rttMs: 80,
      packetsLost: 2,
      packetsSent: 200,
    });
  });
});
