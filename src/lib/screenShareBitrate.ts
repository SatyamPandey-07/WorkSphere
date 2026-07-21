/**
 * Pick a max video bitrate from outbound/candidate-pair stats.
 * Used while screen sharing so we don't blow up slow peers.
 */

export type BitrateTier = {
  maxBitrate: number;
  label: "high" | "medium" | "low";
};

const HIGH: BitrateTier = { maxBitrate: 2_500_000, label: "high" };
const MEDIUM: BitrateTier = { maxBitrate: 1_000_000, label: "medium" };
const LOW: BitrateTier = { maxBitrate: 400_000, label: "low" };

export function pickBitrateTier(input: {
  rttMs?: number;
  packetsLost?: number;
  packetsSent?: number;
}): BitrateTier {
  const rtt = input.rttMs ?? 0;
  const sent = input.packetsSent ?? 0;
  const lost = input.packetsLost ?? 0;
  const lossRatio = sent > 0 ? lost / sent : 0;

  if (rtt > 250 || lossRatio > 0.08) return LOW;
  if (rtt > 120 || lossRatio > 0.03) return MEDIUM;
  return HIGH;
}

/** Read rough RTT / loss from an RTCPeerConnection stats report. */
export function readNetworkHints(report: RTCStatsReport): {
  rttMs?: number;
  packetsLost?: number;
  packetsSent?: number;
} {
  let rttMs: number | undefined;
  let packetsLost: number | undefined;
  let packetsSent: number | undefined;

  report.forEach((stat) => {
    if (stat.type === "candidate-pair" && stat.state === "succeeded") {
      if (typeof stat.currentRoundTripTime === "number") {
        rttMs = stat.currentRoundTripTime * 1000;
      }
    }
    if (stat.type === "outbound-rtp" && stat.kind === "video") {
      if (typeof stat.packetsLost === "number") packetsLost = stat.packetsLost;
      if (typeof stat.packetsSent === "number") packetsSent = stat.packetsSent;
    }
  });

  return { rttMs, packetsLost, packetsSent };
}

export async function adaptVideoBitrate(
  pc: RTCPeerConnection,
): Promise<BitrateTier | null> {
  const sender = pc.getSenders().find((s) => s.track?.kind === "video");
  if (!sender) return null;

  const hints = readNetworkHints(await pc.getStats());
  const tier = pickBitrateTier(hints);
  const params = sender.getParameters();

  if (!params.encodings?.length) {
    params.encodings = [{}];
  }
  params.encodings[0].maxBitrate = tier.maxBitrate;

  try {
    await sender.setParameters(params);
  } catch {
    // Some browsers reject mid-flight tweaks; ignore and keep going.
  }

  return tier;
}
