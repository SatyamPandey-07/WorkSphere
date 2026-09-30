/**
 * Tests for booking personalization engine combining multiple signals.
 */

interface PersonalizationSignals {
  userId: string;
  bookingHistory: { venueId: string; rating: number }[];
  preferredTimeSlot: "morning" | "afternoon" | "evening";
  budgetRangeCents: [number, number];
  favoriteAmenities: string[];
  location: { lat: number; lng: number };
}

interface VenueCandidate {
  venueId: string;
  category: string;
  distanceKm: number;
  peakHour: number;     // hour of day when busiest
  avgRateCents: number;
  amenities: string[];
  avgRating: number;
}

function historyScore(signals: PersonalizationSignals, candidate: VenueCandidate): number {
  const prevVisit = signals.bookingHistory.find((b) => b.venueId === candidate.venueId);
  if (prevVisit) return prevVisit.rating * 20; // known venue with rating
  return 50; // neutral for unknown
}

function timePreferenceScore(signals: PersonalizationSignals, candidate: VenueCandidate): number {
  const timeRanges = { morning: [6, 12], afternoon: [12, 18], evening: [18, 23] };
  const [start, end] = timeRanges[signals.preferredTimeSlot];
  return candidate.peakHour >= start && candidate.peakHour < end ? 30 : 0;
}

function budgetScore(signals: PersonalizationSignals, candidate: VenueCandidate): number {
  const [min, max] = signals.budgetRangeCents;
  if (candidate.avgRateCents < min) return 10;  // too cheap, unusual
  if (candidate.avgRateCents > max) return 0;   // too expensive
  const range = max - min;
  const position = (candidate.avgRateCents - min) / range;
  return Math.round((1 - Math.abs(position - 0.5) * 2) * 20); // prefer middle of range
}

function personalizedScore(signals: PersonalizationSignals, candidate: VenueCandidate): number {
  return historyScore(signals, candidate) + timePreferenceScore(signals, candidate) + budgetScore(signals, candidate);
}

const SIGNALS: PersonalizationSignals = {
  userId: "u1",
  bookingHistory: [{ venueId: "v1", rating: 4.5 }],
  preferredTimeSlot: "morning",
  budgetRangeCents: [500, 1500],
  favoriteAmenities: ["wifi", "coffee"],
  location: { lat: 40.712, lng: -74.006 },
};

const CANDIDATES: VenueCandidate[] = [
  { venueId: "v1", category: "cafe",      distanceKm: 0.5, peakHour: 9,  avgRateCents: 800,  amenities: ["wifi", "coffee"], avgRating: 4.5 },
  { venueId: "v2", category: "coworking", distanceKm: 1.5, peakHour: 14, avgRateCents: 1200, amenities: ["wifi"],           avgRating: 4.2 },
  { venueId: "v3", category: "library",   distanceKm: 2.0, peakHour: 10, avgRateCents: 0,    amenities: ["wifi", "quiet"],  avgRating: 4.8 },
];

describe("Venue booking personalization engine", () => {
  it("historyScore: known venue (v1) scores based on rating", () => {
    expect(historyScore(SIGNALS, CANDIDATES[0])).toBe(90); // 4.5 × 20
  });

  it("historyScore: unknown venue → neutral 50", () => {
    expect(historyScore(SIGNALS, CANDIDATES[1])).toBe(50);
  });

  it("timePreferenceScore: morning user + morning peak venue → 30", () => {
    expect(timePreferenceScore(SIGNALS, CANDIDATES[0])).toBe(30);
  });

  it("timePreferenceScore: morning user + afternoon peak → 0", () => {
    expect(timePreferenceScore(SIGNALS, CANDIDATES[1])).toBe(0);
  });

  it("budgetScore: v1 within range → positive", () => {
    expect(budgetScore(SIGNALS, CANDIDATES[0])).toBeGreaterThan(0);
  });

  it("personalizedScore: v1 (known + morning + in budget) highest", () => {
    const scores = CANDIDATES.map((c) => ({ id: c.venueId, score: personalizedScore(SIGNALS, c) }));
    const highest = scores.reduce((max, s) => s.score > max.score ? s : max);
    expect(highest.id).toBe("v1");
  });
});
