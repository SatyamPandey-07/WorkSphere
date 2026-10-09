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
