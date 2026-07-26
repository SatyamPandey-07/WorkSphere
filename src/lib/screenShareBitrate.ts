/**
 * Pick a max video bitrate from outbound/candidate-pair stats.
 * Used while screen sharing so we don't blow up slow peers.
 */

export type BitrateTier = {
  maxBitrate: number;
  audioMaxBitrate: number;
  label: "high" | "medium" | "low";
};

const HIGH: BitrateTier = {
  maxBitrate: 2_500_000,
  audioMaxBitrate: 64_000,
  label: "high",
};
const MEDIUM: BitrateTier = {
  maxBitrate: 1_000_000,
  audioMaxBitrate: 32_000,
  label: "medium",
};
const LOW: BitrateTier = {
  maxBitrate: 400_000,
  audioMaxBitrate: 16_000,
  label: "low",
};

export function pickBitrateTier(input: {
  rttMs?: number;
  packetsLost?: number;
  packetsSent?: number;
  jitterMs?: number;
}): BitrateTier {
  const rtt = input.rttMs ?? 0;
  const sent = input.packetsSent ?? 0;
  const lost = input.packetsLost ?? 0;
  const jitter = input.jitterMs ?? 0;
  const lossRatio = sent > 0 ? lost / sent : 0;

  if (rtt > 250 || lossRatio > 0.08 || jitter > 50) return LOW;
  if (rtt > 120 || lossRatio > 0.03 || jitter > 20) return MEDIUM;
  return HIGH;
}

/** Read rough RTT, loss, and jitter from an RTCPeerConnection stats report. */
export function readNetworkHints(report: RTCStatsReport): {
  rttMs?: number;
  packetsLost?: number;
  packetsSent?: number;
  jitterMs?: number;
} {
  let rttMs: number | undefined;
  let packetsLost: number | undefined;
  let packetsSent: number | undefined;
  let jitterMs: number | undefined;

  report.forEach((stat: any) => {
    if (stat.type === "candidate-pair" && stat.state === "succeeded") {
      if (typeof stat.currentRoundTripTime === "number") {
        rttMs = stat.currentRoundTripTime * 1000;
      }
    }
    if (stat.type === "remote-inbound-rtp") {
      if (typeof stat.roundTripTime === "number") {
        rttMs = stat.roundTripTime * 1000;
      }
      if (typeof stat.jitter === "number") {
        const jMs = stat.jitter * 1000;
        jitterMs = jitterMs !== undefined ? Math.max(jitterMs, jMs) : jMs;
      }
      if (typeof stat.packetsLost === "number") {
        packetsLost = stat.packetsLost;
      }
    }
    if (stat.type === "inbound-rtp") {
      if (typeof stat.jitter === "number") {
        const jMs = stat.jitter * 1000;
        jitterMs = jitterMs !== undefined ? Math.max(jitterMs, jMs) : jMs;
      }
      if (typeof stat.packetsLost === "number" && packetsLost === undefined) {
        packetsLost = stat.packetsLost;
      }
      if (
        typeof stat.packetsReceived === "number" &&
        packetsSent === undefined
      ) {
        packetsSent = (stat.packetsReceived || 0) + (stat.packetsLost || 0);
      }
    }
    if (
      stat.type === "outbound-rtp" &&
      (stat.kind === "video" || stat.mediaType === "video")
    ) {
      if (typeof stat.packetsLost === "number" && packetsLost === undefined)
        packetsLost = stat.packetsLost;
      if (typeof stat.packetsSent === "number") packetsSent = stat.packetsSent;
    }
  });

  return { rttMs, packetsLost, packetsSent, jitterMs };
}

export async function adaptVideoBitrate(
  pc: RTCPeerConnection,
): Promise<BitrateTier | null> {
  const senders = pc.getSenders();
  const videoSender = senders.find((s) => s.track?.kind === "video");
  const audioSender = senders.find((s) => s.track?.kind === "audio");

  if (!videoSender && !audioSender) return null;

  const hints = readNetworkHints(await pc.getStats());
  const tier = pickBitrateTier(hints);

  if (videoSender) {
    const params = videoSender.getParameters();
    if (!params.encodings?.length) {
      params.encodings = [{}];
    }
    params.encodings[0].maxBitrate = tier.maxBitrate;
    try {
      await videoSender.setParameters(params);
    } catch {
      // Some browsers reject mid-flight tweaks; ignore and keep going.
    }
  }

  if (audioSender) {
    const params = audioSender.getParameters();
    if (!params.encodings?.length) {
      params.encodings = [{}];
    }
    params.encodings[0].maxBitrate = tier.audioMaxBitrate;
    try {
      await audioSender.setParameters(params);
    } catch {
      // Some browsers reject mid-flight tweaks; ignore and keep going.
    }
  }

  return tier;
}
