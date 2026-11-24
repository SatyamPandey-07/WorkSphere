export type JitterTier = 'excellent' | 'fair' | 'poor';

export interface JitterTelemetrySummary {
  sampleCount: number;
  avgPingMs: number;
  jitterMs: number;
  tier: JitterTier;
  statusLabel: string;
  guidanceText: string;
}

export function calculateJitterMs(samples: number[]): number {
  const valid = samples.filter((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0);
  if (valid.length < 2) return 0;

  let totalDelta = 0;
  for (let i = 1; i < valid.length; i += 1) {
    totalDelta += Math.abs(valid[i] - valid[i - 1]);
  }

  const avgDelta = totalDelta / (valid.length - 1);
  return Math.round(avgDelta * 10) / 10;
}

export function classifyJitterTier(jitterMs: number): {
  tier: JitterTier;
  statusLabel: string;
  guidanceText: string;
} {
  const safeJitter = Number.isFinite(jitterMs) && jitterMs >= 0 ? jitterMs : 0;

  if (safeJitter < 15) {
    return {
      tier: 'excellent',
      statusLabel: 'Excellent for Video Calls',
      guidanceText:
        'Steady response times keep Zoom, Google Meet, and voice calls smooth with minimal drop risk.',
    };
  }

  if (safeJitter <= 45) {
    return {
      tier: 'fair',
      statusLabel: 'Good for Browsing & Streaming',
      guidanceText:
        'Fine for web apps, cloud docs, and video streaming; occasional lag spikes may occur on live calls.',
    };
  }

  return {
    tier: 'poor',
    statusLabel: 'High Jitter — Audio/Video May Stutter',
    guidanceText:
      'Large swings in ping delay can cause frozen video, robotic audio, or disconnects in calls and games.',
  };
}

export function summarizePingTelemetry(samples: number[]): JitterTelemetrySummary {
  const valid = samples.filter((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0);
  const sampleCount = valid.length;
  const avgPingMs =
    sampleCount > 0
      ? Math.round((valid.reduce((acc, v) => acc + v, 0) / sampleCount) * 10) / 10
      : 0;
  const jitterMs = calculateJitterMs(valid);
  const { tier, statusLabel, guidanceText } = classifyJitterTier(jitterMs);

  return {
    sampleCount,
    avgPingMs,
    jitterMs,
    tier,
    statusLabel,
    guidanceText,
  };
}
