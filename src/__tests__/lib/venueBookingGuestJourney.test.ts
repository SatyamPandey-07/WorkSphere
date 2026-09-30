/**
 * Tests for venue booking guest journey mapping.
 */

type JourneyStage =
  | "awareness"
  | "consideration"
  | "booking"
  | "pre_arrival"
  | "arrival"
  | "experience"
  | "departure"
  | "post_stay";

interface JourneyTouchpoint {
  stage: JourneyStage;
  channel: string;
  sentimentScore: number; // -1 to 1
  resolutionMs: number | null;
}

function avgSentiment(touchpoints: JourneyTouchpoint[]): number {
  if (touchpoints.length === 0) return 0;
  return Math.round(
    (touchpoints.reduce((s, t) => s + t.sentimentScore, 0) / touchpoints.length) * 100
  ) / 100;
}

function painPoints(touchpoints: JourneyTouchpoint[], threshold = -0.3): JourneyTouchpoint[] {
  return touchpoints.filter((t) => t.sentimentScore < threshold);
}

function stageConversionRate(
  fromStage: JourneyStage,
  toStage: JourneyStage,
  journeys: JourneyTouchpoint[][]
): number {
  const reached = journeys.filter((j) => j.some((t) => t.stage === fromStage)).length;
  if (reached === 0) return 0;
  const converted = journeys.filter(
    (j) => j.some((t) => t.stage === fromStage) && j.some((t) => t.stage === toStage)
  ).length;
  return Math.round((converted / reached) * 100);
}

function avgResolutionMs(touchpoints: JourneyTouchpoint[]): number {
  const resolved = touchpoints.filter((t) => t.resolutionMs !== null);
  if (resolved.length === 0) return 0;
  return Math.round(resolved.reduce((s, t) => s + t.resolutionMs!, 0) / resolved.length);
}

function bestChannel(touchpoints: JourneyTouchpoint[]): string | null {
  if (touchpoints.length === 0) return null;
  const channelSentiments: Record<string, number[]> = {};
  for (const t of touchpoints) {
    if (!channelSentiments[t.channel]) channelSentiments[t.channel] = [];
    channelSentiments[t.channel].push(t.sentimentScore);
  }
  let best = "";
  let bestAvg = -Infinity;
  for (const [ch, scores] of Object.entries(channelSentiments)) {
    const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
    if (avg > bestAvg) { bestAvg = avg; best = ch; }
  }
  return best;
}

const JOURNEY: JourneyTouchpoint[] = [
  { stage: "awareness",   channel: "social",  sentimentScore: 0.6,  resolutionMs: null },
  { stage: "booking",     channel: "website", sentimentScore: -0.4, resolutionMs: 3600_000 },
  { stage: "arrival",     channel: "app",     sentimentScore: 0.8,  resolutionMs: null },
  { stage: "post_stay",   channel: "email",   sentimentScore: 0.3,  resolutionMs: null },
];

describe("Guest journey mapping", () => {
  it("avgSentiment: positive overall", () => {
    expect(avgSentiment(JOURNEY)).toBeGreaterThan(0);
  });

  it("painPoints: booking stage has negative sentiment", () => {
    const pp = painPoints(JOURNEY);
    expect(pp.some((t) => t.stage === "booking")).toBe(true);
  });

  it("avgResolutionMs: 3600000 for single resolved touchpoint", () => {
    expect(avgResolutionMs(JOURNEY)).toBe(3_600_000);
  });

  it("bestChannel: social or app have highest sentiment", () => {
    const best = bestChannel(JOURNEY);
    expect(["social", "app"]).toContain(best);
  });

  it("stageConversionRate: 100% from awareness to booking for one journey", () => {
    const journeys = [JOURNEY];
    const rate = stageConversionRate("awareness", "booking", journeys);
    expect(rate).toBe(100);
  });

  it("avgSentiment: empty → 0", () => {
    expect(avgSentiment([])).toBe(0);
  });
});
