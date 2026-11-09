import { ItineraryGraph } from "@/core/itinerary/ItineraryGraph";
import {
  TRANSIT_EMISSION_COEFFICIENTS,
  TransitSolver,
} from "@/core/itinerary/TransitSolver";
import { TimeWindowConstraint } from "@/core/itinerary/TimeWindowConstraint";

function buildGraph() {
  const graph = new ItineraryGraph();
  for (const id of ["start", "eco", "fast"]) {
    graph.addNode({
      id,
      name: id,
      latitude: 0,
      longitude: 0,
      openingHours: "24/7",
      averageDwellTimeMinutes: 0,
      timezone: "UTC",
    });
  }
  graph.addEdge({
    fromVenueId: "start",
    toVenueId: "eco",
    transitTimeMinutes: 20,
    distanceMeters: 5_000,
    mode: "cycling",
  });
  graph.addEdge({
    fromVenueId: "start",
    toVenueId: "fast",
    transitTimeMinutes: 5,
    distanceMeters: 5_000,
    mode: "rideshare",
  });
  graph.addEdge({
    fromVenueId: "eco",
    toVenueId: "fast",
    transitTimeMinutes: 5,
    distanceMeters: 1_000,
    mode: "cycling",
  });
  graph.addEdge({
    fromVenueId: "fast",
    toVenueId: "eco",
    transitTimeMinutes: 20,
    distanceMeters: 1_000,
    mode: "rideshare",
  });
  return graph;
}

describe("TransitSolver carbon objectives", () => {
  it("uses mode coefficients to calculate itinerary emissions", () => {
    const solver = new TransitSolver(buildGraph(), new TimeWindowConstraint());
    const result = solver.solve("start", ["eco"], new Date("2026-01-01T00:00:00Z"), {
      objective: "carbon",
    });

    expect(result?.totalCarbonGrams).toBe(20);
    expect(TRANSIT_EMISSION_COEFFICIENTS.rideshare).toBe(120);
  });

  it("returns Pareto suggestions for time and carbon objectives", () => {
    const solver = new TransitSolver(buildGraph(), new TimeWindowConstraint());
    const start = new Date("2026-01-01T00:00:00Z");

    expect(
      solver.solve("start", ["fast"], start, { objective: "time" })?.totalDurationMinutes,
    ).toBe(5);
    expect(solver.optimizePareto("start", ["eco", "fast"], start)).toHaveLength(2);
  });

  it("supports the lowest-cost objective", () => {
    const graph = buildGraph();
    graph.addEdge({
      fromVenueId: "eco",
      toVenueId: "fast",
      transitTimeMinutes: 5,
      distanceMeters: 1_000,
      mode: "train",
      cost: 2,
    });
    const solver = new TransitSolver(graph, new TimeWindowConstraint());
    const result = solver.solve("start", ["eco"], new Date("2026-01-01T00:00:00Z"), {
      objective: "cost",
    });

    expect(result?.totalCost).toBe(0);
    expect(TRANSIT_EMISSION_COEFFICIENTS.train).toBe(41);
  });
});

describe("Multi-Venue Break Duration Customization in TimeWindowConstraint (#6159)", () => {
  const {
    validateBreakDuration,
    DEFAULT_TRANSIT_BUFFER_MIN,
    MIN_BREAK_DURATION_MINUTES,
    MAX_BREAK_DURATION_MINUTES,
  } = require("@/core/itinerary/TimeWindowConstraint");

  it("exports standard break duration boundary constants", () => {
    expect(DEFAULT_TRANSIT_BUFFER_MIN).toBe(15);
    expect(MIN_BREAK_DURATION_MINUTES).toBe(0);
    expect(MAX_BREAK_DURATION_MINUTES).toBe(240);
  });

  describe("validateBreakDuration bounds enforcement", () => {
    it("accepts valid break durations between 0 and 240 minutes", () => {
      expect(validateBreakDuration(0)).toBe(0);
      expect(validateBreakDuration(15)).toBe(15);
      expect(validateBreakDuration(45)).toBe(45);
      expect(validateBreakDuration(120)).toBe(120);
      expect(validateBreakDuration(240)).toBe(240);
      expect(validateBreakDuration(undefined)).toBe(0);
    });

    it("throws error for negative break durations (< 0)", () => {
      expect(() => validateBreakDuration(-1)).toThrow(/between 0 and 240 minutes/);
      expect(() => validateBreakDuration(-45)).toThrow(/between 0 and 240 minutes/);
    });

    it("throws error for excessive break durations (> 240)", () => {
      expect(() => validateBreakDuration(241)).toThrow(/between 0 and 240 minutes/);
      expect(() => validateBreakDuration(300)).toThrow(/between 0 and 240 minutes/);
    });

    it("throws error for NaN or non-finite inputs", () => {
      expect(() => validateBreakDuration(NaN)).toThrow(/finite number/);
      expect(() => validateBreakDuration(Infinity)).toThrow(/finite number/);
      expect(() => validateBreakDuration(-Infinity)).toThrow(/finite number/);
    });
  });

  describe("calculateEarliestArrival and validateTransitWindow with custom breaks", () => {
    it("offsets earliest arrival time by transit plus custom break duration", () => {
      const timeConstraint = new TimeWindowConstraint();
      const departure = new Date("2026-10-12T12:00:00Z");

      // 15 min transit + 45 min lunch break = 60 mins offset
      const arrivalWithBreak = timeConstraint.calculateEarliestArrival(departure, 15, {
        customBreakDurationMinutes: 45,
      });
      expect(arrivalWithBreak.getTime() - departure.getTime()).toBe(60 * 60000);

      // Default with no options = 15 mins offset
      const arrivalNoBreak = timeConstraint.calculateEarliestArrival(departure, 15);
      expect(arrivalNoBreak.getTime() - departure.getTime()).toBe(15 * 60000);
    });

    it("validates transit window considering transit time plus break duration", () => {
      const timeConstraint = new TimeWindowConstraint();
      const v1 = {
        id: "v1",
        name: "Morning Focus",
        latitude: 37.7749,
        longitude: -122.4194,
        openingHours: "24/7",
        averageDwellTimeMinutes: 120,
        timezone: "UTC",
      };
      const v2 = {
        id: "v2",
        name: "Afternoon Hub",
        latitude: 37.7849,
        longitude: -122.4094,
        openingHours: "24/7",
        averageDwellTimeMinutes: 120,
        timezone: "UTC",
      };

      const slot1 = {
        venue: v1,
        startTime: new Date("2026-10-12T09:00:00Z"),
        endTime: new Date("2026-10-12T11:00:00Z"),
      };

      // Gap is 30 mins (11:00 to 11:30)
      const slot2 = {
        venue: v2,
        startTime: new Date("2026-10-12T11:30:00Z"),
        endTime: new Date("2026-10-12T13:30:00Z"),
      };

      // If transit is ~15 min and user requires 45 min lunch break (total 60 mins needed), gap is insufficient
      const resultFails = timeConstraint.validateTransitWindow(slot1, slot2, "walking", undefined, {
        customBreakDurationMinutes: 45,
      });
      expect(resultFails.isValid).toBe(false);
      expect(resultFails.error).toContain("Insufficient transit allowance");
      expect(resultFails.error).toContain("45m break");

      // If gap is 90 mins (11:00 to 12:30), window should pass
      const slot2Later = {
        venue: v2,
        startTime: new Date("2026-10-12T12:30:00Z"),
        endTime: new Date("2026-10-12T14:30:00Z"),
      };
      const resultPasses = timeConstraint.validateTransitWindow(slot1, slot2Later, "walking", undefined, {
        customBreakDurationMinutes: 45,
      });
      expect(resultPasses.isValid).toBe(true);
    });

    it("supports segment-level break duration overrides", () => {
      const timeConstraint = new TimeWindowConstraint();
      const resolved = timeConstraint.resolveBreakDuration(
        {
          customBreakDurationMinutes: 15,
          segmentBreakDurations: {
            "v1->v2": 60,
          },
        },
        "v1",
        "v2"
      );
      expect(resolved).toBe(60);

      const resolvedDefault = timeConstraint.resolveBreakDuration(
        {
          customBreakDurationMinutes: 15,
          segmentBreakDurations: {
            "v1->v2": 60,
          },
        },
        "v2",
        "v3"
      );
      expect(resolvedDefault).toBe(15);
    });
  });

  describe("TransitSolver integration with custom break durations", () => {
    it("incorporates custom break duration into TSPTW itinerary solution schedule and duration", () => {
      const graph = buildGraph();
      const timeConstraint = new TimeWindowConstraint();
      const solver = new TransitSolver(graph, timeConstraint);
      const start = new Date("2026-01-01T10:00:00Z");

      // Fast edge has 5 mins transit. With 30 min custom break, arrival at fast should be +35 mins
      const solution = solver.solve("start", ["fast"], start, {
        customBreakDurationMinutes: 30,
      });

      expect(solution).not.toBeNull();
      expect(solution!.totalTransitTimeMinutes).toBe(5);
      expect(solution!.totalBreakTimeMinutes).toBe(30);
      expect(solution!.totalDurationMinutes).toBe(35); // 5m transit + 0m dwell + 0m wait + 30m break
      expect(solution!.schedule[1].breakTimeMinutes).toBe(30);

      const arrivalTime = solution!.schedule[1].arrivalTime;
      expect((arrivalTime.getTime() - start.getTime()) / 60000).toBe(35);
    });

    it("rejects invalid break durations in solver.solve", () => {
      const solver = new TransitSolver(buildGraph(), new TimeWindowConstraint());
      const start = new Date("2026-01-01T10:00:00Z");

      expect(() =>
        solver.solve("start", ["fast"], start, {
          customBreakDurationMinutes: -15,
        })
      ).toThrow(/between 0 and 240 minutes/);

      expect(() =>
        solver.solve("start", ["fast"], start, {
          customBreakDurationMinutes: 300,
        })
      ).toThrow(/between 0 and 240 minutes/);
    });
  });
});

