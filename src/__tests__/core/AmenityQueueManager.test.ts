import {
  AmenityQueueManager,
  normalizeAmenityType,
  DEFAULT_BASELINE_DURATIONS,
} from "@/core/predictive/AmenityQueueManager";

describe("normalizeAmenityType", () => {
  it("normalizes various casing and spacing conventions", () => {
    expect(normalizeAmenityType("Phone Booth")).toBe("phone_booth");
    expect(normalizeAmenityType("phone-booth")).toBe("phone_booth");
    expect(normalizeAmenityType("Standing Desk")).toBe("standing_desk");
    expect(normalizeAmenityType("standing_desk")).toBe("standing_desk");
    expect(normalizeAmenityType("Private Meeting Room")).toBe(
      "private_meeting_room",
    );
    expect(normalizeAmenityType("conference room")).toBe(
      "private_meeting_room",
    );
  });
});

describe("AmenityQueueManager - Turnover History & EMA", () => {
  let manager: AmenityQueueManager;

  beforeEach(() => {
    manager = new AmenityQueueManager(2.5, 5, 0.3); // rolling window of 5 for easy testing
  });

  it("uses default baseline durations when no historical turnovers exist", () => {
    expect(manager.getAverageDurationMinutes("phone_booth")).toBe(
      DEFAULT_BASELINE_DURATIONS.phone_booth,
    );
    expect(manager.getAverageDurationMinutes("standing_desk")).toBe(
      DEFAULT_BASELINE_DURATIONS.standing_desk,
    );
    expect(manager.getAverageDurationMinutes("private_meeting_room")).toBe(
      DEFAULT_BASELINE_DURATIONS.private_meeting_room,
    );
  });

  it("tracks turnover duration rolling window and updates EMA smoothly", () => {
    // First record: EMA is initialized to the first value
    manager.recordTurnover("phone_booth", 10);
    expect(manager.getAverageDurationMinutes("phone_booth")).toBe(10);
    expect(manager.getTurnoverHistory("phone_booth")).toEqual([10]);

    // Second record: EMA = 0.3 * 20 + 0.7 * 10 = 6 + 7 = 13
    manager.recordTurnover("phone_booth", 20);
    expect(manager.getAverageDurationMinutes("phone_booth")).toBe(13);
    expect(manager.getTurnoverHistory("phone_booth")).toEqual([10, 20]);

    // Add more entries up to rolling window size of 5
    manager.recordTurnover("phone_booth", 15);
    manager.recordTurnover("phone_booth", 12);
    manager.recordTurnover("phone_booth", 18);
    expect(manager.getTurnoverHistory("phone_booth")).toHaveLength(5);

    // Adding 6th entry should evict oldest (10)
    manager.recordTurnover("phone_booth", 25);
    const history = manager.getTurnoverHistory("phone_booth");
    expect(history).toHaveLength(5);
    expect(history[0]).toBe(20);
    expect(history[4]).toBe(25);
  });

  it("ignores invalid or non-positive turnover durations", () => {
    manager.recordTurnover("phone_booth", -5);
    manager.recordTurnover("phone_booth", 0);
    manager.recordTurnover("phone_booth", NaN);
    expect(manager.getTurnoverHistory("phone_booth")).toEqual([]);
  });
});

describe("AmenityQueueManager - Wait Time Estimation & Confidence Bounds", () => {
  let manager: AmenityQueueManager;

  beforeEach(() => {
    manager = new AmenityQueueManager(2.5, 20, 0.3);
  });

  it("returns zero wait time and zero bounds when queuePosition is 0 or negative", () => {
    const estimate = manager.calculateWaitTime("phone_booth", 0);
    expect(estimate.queuePosition).toBe(0);
    expect(estimate.estimatedWaitMinutes).toBe(0);
    expect(estimate.minEstimate).toBe(0);
    expect(estimate.maxEstimate).toBe(0);
    expect(estimate.confidence).toBe(1.0);
  });

  it("computes estimatedWaitMinutes = queuePosition * averageDurationMinutes", () => {
    // Record fixed turnover for standing desk
    manager.recordTurnover("standing_desk", 30);
    manager.recordTurnover("standing_desk", 30);

    const queuePosition = 3;
    const estimate = manager.calculateWaitTime("standing_desk", queuePosition);

    expect(estimate.amenityType).toBe("standing_desk");
    expect(estimate.queuePosition).toBe(3);
    expect(estimate.averageDurationMinutes).toBe(30);
    // estimatedWaitMinutes = 3 * 30 = 90
    expect(estimate.estimatedWaitMinutes).toBe(90);
  });

  it("returns valid confidence interval bounds with minEstimate <= estimatedWaitMinutes <= maxEstimate", () => {
    // Populate realistic turnover distribution for private meeting rooms (40 - 60 minutes)
    const turnovers = [45, 50, 40, 55, 60, 45, 50];
    for (const d of turnovers) {
      manager.recordTurnover("private_meeting_room", d);
    }

    const estimate = manager.calculateWaitTime("private_meeting_room", 2);

    expect(estimate.estimatedWaitMinutes).toBeGreaterThan(0);
    expect(estimate.minEstimate).toBeLessThanOrEqual(
      estimate.estimatedWaitMinutes,
    );
    expect(estimate.maxEstimate).toBeGreaterThanOrEqual(
      estimate.estimatedWaitMinutes,
    );
    expect(estimate.minEstimate).toBeGreaterThanOrEqual(0);
    expect(estimate.confidence).toBeGreaterThan(0.6);
  });

  it("handles telemetry ingestion with turnover durations", () => {
    manager.ingestReport({
      zoneId: "booth-zone-1",
      venueId: "venue-sf-01",
      estimatedCount: 2,
      confidence: 0.9,
      timestamp: Date.now(),
      amenityType: "phone_booth",
      turnoverDurationMinutes: 14,
    });

    const history = manager.getTurnoverHistory("phone_booth");
    expect(history).toContain(14);

    const prediction = manager.getPrediction("booth-zone-1");
    expect(prediction).not.toBeNull();
    expect(prediction?.estimatedWaitMinutes).toBeDefined();
    expect(prediction?.minEstimate).toBeDefined();
    expect(prediction?.maxEstimate).toBeDefined();
  });
});
