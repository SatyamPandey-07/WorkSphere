/**
 * Tests for venue customer journey mapping and touchpoint analysis.
 */

type JourneyStage = "awareness" | "consideration" | "booking" | "experience" | "loyalty";

interface JourneyTouchpoint {
  touchpointId: string;
  stage: JourneyStage;
  channel: "organic_search" | "social_media" | "email" | "word_of_mouth" | "direct" | "app";
  satisfactionScore: number;  // 1-10
  effortScore: number;        // 1-10 (lower = less effort = better)
  conversionInfluence: number; // -1 to 1
}

function customerEffortScore(touchpoints: JourneyTouchpoint[], stage: JourneyStage): number {
  const stageTPs = touchpoints.filter((t) => t.stage === stage);
  if (stageTPs.length === 0) return 0;
  return Math.round(stageTPs.reduce((s, t) => s + t.effortScore, 0) / stageTPs.length * 10) / 10;
}

function stageSatisfaction(touchpoints: JourneyTouchpoint[], stage: JourneyStage): number {
  const stageTPs = touchpoints.filter((t) => t.stage === stage);
  if (stageTPs.length === 0) return 0;
  return Math.round(stageTPs.reduce((s, t) => s + t.satisfactionScore, 0) / stageTPs.length * 10) / 10;
}

function mostInfluentialChannel(touchpoints: JourneyTouchpoint[]): string | null {
  if (touchpoints.length === 0) return null;
  const channelScores: Record<string, number> = {};
  touchpoints.forEach((t) => {
    channelScores[t.channel] = (channelScores[t.channel] ?? 0) + t.conversionInfluence;
  });
  return Object.entries(channelScores).reduce((max, e) => Number(e[1]) > Number(max[1]) ? e : max)[0];
}

function frictionPoints(touchpoints: JourneyTouchpoint[], effortThreshold = 7): JourneyTouchpoint[] {
  return touchpoints.filter((t) => t.effortScore >= effortThreshold);
}

function journeyHealthScore(touchpoints: JourneyTouchpoint[]): number {
  if (touchpoints.length === 0) return 0;
  const avgSatisfaction = touchpoints.reduce((s, t) => s + t.satisfactionScore, 0) / touchpoints.length;
  const avgEffort = touchpoints.reduce((s, t) => s + t.effortScore, 0) / touchpoints.length;
  const avgInfluence = touchpoints.reduce((s, t) => s + t.conversionInfluence, 0) / touchpoints.length;
  return Math.round((avgSatisfaction / 10 + (10 - avgEffort) / 10 + (avgInfluence + 1) / 2) / 3 * 100);
}

const TOUCHPOINTS: JourneyTouchpoint[] = [
  { touchpointId: "t1", stage: "awareness",     channel: "social_media", satisfactionScore: 7, effortScore: 3, conversionInfluence: 0.4 },
  { touchpointId: "t2", stage: "consideration", channel: "organic_search",satisfactionScore: 8, effortScore: 4, conversionInfluence: 0.6 },
  { touchpointId: "t3", stage: "booking",       channel: "direct",       satisfactionScore: 6, effortScore: 8, conversionInfluence: 0.8 },
  { touchpointId: "t4", stage: "experience",    channel: "app",          satisfactionScore: 9, effortScore: 2, conversionInfluence: 0.9 },
];

describe("Venue customer journey map", () => {
  it("customerEffortScore: booking stage = 8.0", () => {
    expect(customerEffortScore(TOUCHPOINTS, "booking")).toBe(8);
  });

  it("stageSatisfaction: experience stage = 9.0", () => {
    expect(stageSatisfaction(TOUCHPOINTS, "experience")).toBe(9);
  });

  it("mostInfluentialChannel: app (highest influence)", () => {
    expect(mostInfluentialChannel(TOUCHPOINTS)).toBe("app");
  });

  it("frictionPoints: booking touchpoint is friction (effort=8)", () => {
    const friction = frictionPoints(TOUCHPOINTS);
    expect(friction.some((t) => t.touchpointId === "t3")).toBe(true);
  });

  it("frictionPoints: low effort touchpoints excluded", () => {
    const friction = frictionPoints(TOUCHPOINTS);
    expect(friction.some((t) => t.touchpointId === "t1")).toBe(false);
  });

  it("journeyHealthScore: positive health from good journey", () => {
    expect(journeyHealthScore(TOUCHPOINTS)).toBeGreaterThan(50);
  });
});
