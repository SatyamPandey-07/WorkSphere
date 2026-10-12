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
const DATA_SAVER_BITRATE_RATIO = 0.36;
const DATA_SAVER_MAX_BITRATE = 900_000;

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

  report.forEach((stat) => {
    if (
      stat.type === "candidate-pair" &&
      (("state" in stat && stat.state === "succeeded") ||
        ("nominated" in stat && stat.nominated === true))
    ) {
      if (
        "currentRoundTripTime" in stat &&
        typeof stat.currentRoundTripTime === "number"
      ) {
        rttMs = stat.currentRoundTripTime * 1000;
      }
    }
    if (stat.type === "remote-inbound-rtp") {
      if ("roundTripTime" in stat && typeof stat.roundTripTime === "number") {
        rttMs = stat.roundTripTime * 1000;
      }
      if ("jitter" in stat && typeof stat.jitter === "number") {
        const jMs = stat.jitter * 1000;
        jitterMs = jitterMs !== undefined ? Math.max(jitterMs, jMs) : jMs;
      }
      if ("packetsLost" in stat && typeof stat.packetsLost === "number") {
        packetsLost = (packetsLost ?? 0) + stat.packetsLost;
      }
    }
    if (stat.type === "inbound-rtp") {
      if ("jitter" in stat && typeof stat.jitter === "number") {
        const jMs = stat.jitter * 1000;
        jitterMs = jitterMs !== undefined ? Math.max(jitterMs, jMs) : jMs;
      }
      if (
        "packetsLost" in stat &&
        typeof stat.packetsLost === "number" &&
        packetsLost === undefined
      ) {
        packetsLost = (packetsLost ?? 0) + stat.packetsLost;
      }
      if (
        "packetsReceived" in stat &&
        typeof stat.packetsReceived === "number" &&
        packetsSent === undefined
      ) {
        const lost =
          "packetsLost" in stat && typeof stat.packetsLost === "number"
            ? stat.packetsLost
            : 0;
        packetsSent = (packetsSent ?? 0) + stat.packetsReceived + lost;
      }
    }
    if (stat.type === "outbound-rtp") {
      if (
        "packetsLost" in stat &&
        typeof stat.packetsLost === "number" &&
        packetsLost === undefined
      ) {
        packetsLost = (packetsLost ?? 0) + stat.packetsLost;
      }
      if ("packetsSent" in stat && typeof stat.packetsSent === "number") {
        packetsSent = (packetsSent ?? 0) + stat.packetsSent;
      }
    }
  });

  return { rttMs, packetsLost, packetsSent, jitterMs };
}

export async function adaptVideoBitrate(
  pc: RTCPeerConnection,
  options: { dataSaverMode?: boolean } = {},
): Promise<BitrateTier | null> {
  if (pc.signalingState === "closed" || (pc.connectionState && pc.connectionState === "closed")) {
    return null;
  }
  let senders: RTCRtpSender[] = [];
  try {
    senders = pc.getSenders();
  } catch {
    return null;
  }
  const videoSender = senders.find((s) => s.track?.kind === "video");
  const audioSender = senders.find((s) => s.track?.kind === "audio");

  if (!videoSender && !audioSender) return null;

  try {
    const stats = await pc.getStats();
    const hints = readNetworkHints(stats);
    const tier = pickBitrateTier(hints);

    if (videoSender) {
      const params = videoSender.getParameters();
      if (!params.encodings?.length) {
        params.encodings = [{}];
      }
      const videoBitrate = options.dataSaverMode
        ? Math.min(
            tier.maxBitrate * DATA_SAVER_BITRATE_RATIO,
            DATA_SAVER_MAX_BITRATE,
          )
        : tier.maxBitrate;
      const perEncodingBitrate = Math.floor(
        videoBitrate / params.encodings.length,
      );
      for (const encoding of params.encodings) {
        encoding.maxBitrate = perEncodingBitrate;
      }
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
  } catch {
    return null;
  }
}
