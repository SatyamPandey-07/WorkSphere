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

export function pickBitrateTier(input?: {
  rttMs?: number;
  packetsLost?: number;
  packetsSent?: number;
  jitterMs?: number;
} | null): BitrateTier {
  if (!input || typeof input !== "object") {
    return MEDIUM;
  }

  // If telemetry contains NaN or non-finite values, it indicates unstable/unreliable telemetry;
  // fall back conservatively to MEDIUM rather than defaulting to HIGH.
  const hasCorruptedTelemetry =
    (input.rttMs !== undefined && !Number.isFinite(input.rttMs)) ||
    (input.packetsLost !== undefined && !Number.isFinite(input.packetsLost)) ||
    (input.packetsSent !== undefined && !Number.isFinite(input.packetsSent)) ||
    (input.jitterMs !== undefined && !Number.isFinite(input.jitterMs));

  if (hasCorruptedTelemetry) {
    return MEDIUM;
  }

  const rtt = typeof input.rttMs === "number" && input.rttMs > 0 ? input.rttMs : 0;
  const sent = typeof input.packetsSent === "number" && input.packetsSent > 0 ? input.packetsSent : 0;
  const lost = typeof input.packetsLost === "number" && input.packetsLost > 0 ? input.packetsLost : 0;
  const jitter = typeof input.jitterMs === "number" && input.jitterMs > 0 ? input.jitterMs : 0;

  const rawLossRatio = sent > 0 ? lost / sent : 0;
  const lossRatio = Math.max(0, Math.min(1, rawLossRatio));

  if (rtt > 250 || lossRatio > 0.08 || jitter > 50) return LOW;
  if (rtt > 120 || lossRatio > 0.03 || jitter > 20) return MEDIUM;
  return HIGH;
}

/** Read rough RTT, loss, and jitter from an RTCPeerConnection stats report. */
export function readNetworkHints(report?: RTCStatsReport | null): {
  rttMs?: number;
  packetsLost?: number;
  packetsSent?: number;
  jitterMs?: number;
} {
  let rttMs: number | undefined;
  let packetsLost: number | undefined;
  let packetsSent: number | undefined;
  let jitterMs: number | undefined;

  if (!report || typeof report.forEach !== "function") {
    return {};
  }

  report.forEach((stat) => {
    if (!stat || typeof stat !== "object" || !("type" in stat)) return;

    if (
      stat.type === "candidate-pair" &&
      (("state" in stat && stat.state === "succeeded") ||
        ("nominated" in stat && stat.nominated === true))
    ) {
      if (
        "currentRoundTripTime" in stat &&
        typeof stat.currentRoundTripTime === "number" &&
        Number.isFinite(stat.currentRoundTripTime) &&
        stat.currentRoundTripTime >= 0
      ) {
        rttMs = stat.currentRoundTripTime * 1000;
      }
    }
    if (stat.type === "remote-inbound-rtp") {
      if (
        "roundTripTime" in stat &&
        typeof stat.roundTripTime === "number" &&
        Number.isFinite(stat.roundTripTime) &&
        stat.roundTripTime >= 0
      ) {
        rttMs = stat.roundTripTime * 1000;
      }
      if (
        "jitter" in stat &&
        typeof stat.jitter === "number" &&
        Number.isFinite(stat.jitter) &&
        stat.jitter >= 0
      ) {
        const jMs = stat.jitter * 1000;
        jitterMs = jitterMs !== undefined ? Math.max(jitterMs, jMs) : jMs;
      }
      if (
        "packetsLost" in stat &&
        typeof stat.packetsLost === "number" &&
        Number.isFinite(stat.packetsLost) &&
        stat.packetsLost >= 0
      ) {
        packetsLost = (packetsLost ?? 0) + stat.packetsLost;
      }
    }
    if (stat.type === "inbound-rtp") {
      if (
        "jitter" in stat &&
        typeof stat.jitter === "number" &&
        Number.isFinite(stat.jitter) &&
        stat.jitter >= 0
      ) {
        const jMs = stat.jitter * 1000;
        jitterMs = jitterMs !== undefined ? Math.max(jitterMs, jMs) : jMs;
      }
      if (
        "packetsLost" in stat &&
        typeof stat.packetsLost === "number" &&
        Number.isFinite(stat.packetsLost) &&
        stat.packetsLost >= 0 &&
        packetsLost === undefined
      ) {
        packetsLost = (packetsLost ?? 0) + stat.packetsLost;
      }
      if (
        "packetsReceived" in stat &&
        typeof stat.packetsReceived === "number" &&
        Number.isFinite(stat.packetsReceived) &&
        stat.packetsReceived >= 0 &&
        packetsSent === undefined
      ) {
        const lost =
          "packetsLost" in stat &&
          typeof stat.packetsLost === "number" &&
          Number.isFinite(stat.packetsLost) &&
          stat.packetsLost >= 0
            ? stat.packetsLost
            : 0;
        packetsSent = (packetsSent ?? 0) + stat.packetsReceived + lost;
      }
    }
    if (stat.type === "outbound-rtp") {
      if (
        "packetsLost" in stat &&
        typeof stat.packetsLost === "number" &&
        Number.isFinite(stat.packetsLost) &&
        stat.packetsLost >= 0 &&
        packetsLost === undefined
      ) {
        packetsLost = (packetsLost ?? 0) + stat.packetsLost;
      }
      if (
        "packetsSent" in stat &&
        typeof stat.packetsSent === "number" &&
        Number.isFinite(stat.packetsSent) &&
        stat.packetsSent >= 0
      ) {
        packetsSent = (packetsSent ?? 0) + stat.packetsSent;
      }
    }
  });

  return { rttMs, packetsLost, packetsSent, jitterMs };
}

export async function adaptVideoBitrate(
  pc: RTCPeerConnection | null | undefined,
  options: { dataSaverMode?: boolean } = {},
): Promise<BitrateTier | null> {
  if (
    !pc ||
    typeof pc !== "object" ||
    pc.signalingState === "closed" ||
    (pc.connectionState && pc.connectionState === "closed") ||
    typeof pc.getSenders !== "function" ||
    typeof pc.getStats !== "function"
  ) {
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
      const rawPerEncoding = Math.floor(
        videoBitrate / (params.encodings.length || 1),
      );
      // Floor at 50 kbps minimum bitrate to avoid invalid zero/negative encoding values
      const perEncodingBitrate = Math.max(50_000, rawPerEncoding);
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
      // Floor at 8 kbps minimum audio bitrate
      params.encodings[0].maxBitrate = Math.max(8_000, tier.audioMaxBitrate);
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
