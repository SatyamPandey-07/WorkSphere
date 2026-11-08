import { ItineraryGraph } from "@/core/itinerary/ItineraryGraph";
import { TimeWindowConstraint } from "@/core/itinerary/TimeWindowConstraint";
import { TransitSolver } from "@/core/itinerary/TransitSolver";

describe("TransitSolver & TimeWindowConstraint - TSPTW Optimization", () => {
  let graph: ItineraryGraph;
  let timeConstraint: TimeWindowConstraint;
  let solver: TransitSolver;

  beforeEach(() => {
    graph = new ItineraryGraph();
    timeConstraint = new TimeWindowConstraint();

    // Add nodes
    graph.addNode({
      id: "v-start",
      name: "Hotel Base",
      latitude: 37.7749,
      longitude: -122.4194,
      openingHours: "24/7",
      averageDwellTimeMinutes: 15,
      timezone: "America/Los_Angeles",
    });

    graph.addNode({
      id: "v-cafe",
      name: "Sightglass Coffee",
      latitude: 37.7775,
      longitude: -122.4085,
      openingHours: "Mo-Fr 08:00-18:00",
      averageDwellTimeMinutes: 45,
      timezone: "America/Los_Angeles",
    });

    graph.addNode({
      id: "v-hub",
      name: "SoMa Coworking Hub",
      latitude: 37.7812,
      longitude: -122.4011,
      openingHours: "Mo-Fr 09:00-20:00",
      averageDwellTimeMinutes: 120,
      timezone: "America/Los_Angeles",
    });

    // Add transit edges
    graph.addEdge({
      fromVenueId: "v-start",
      toVenueId: "v-cafe",
      transitTimeMinutes: 10,
      distanceMeters: 1200,
      mode: "walking",
    });
    graph.addEdge({
      fromVenueId: "v-cafe",
      toVenueId: "v-hub",
      transitTimeMinutes: 15,
      distanceMeters: 1800,
      mode: "walking",
    });
    graph.addEdge({
      fromVenueId: "v-start",
      toVenueId: "v-hub",
      transitTimeMinutes: 22,
      distanceMeters: 2500,
      mode: "walking",
    });
    graph.addEdge({
      fromVenueId: "v-hub",
      toVenueId: "v-cafe",
      transitTimeMinutes: 15,
      distanceMeters: 1800,
      mode: "walking",
    });

    // Parse opening hours
    timeConstraint.parseOpeningHours("v-start", "24/7");
    timeConstraint.parseOpeningHours("v-cafe", "Mo-Fr 08:00-18:00");
    timeConstraint.parseOpeningHours("v-hub", "Mo-Fr 09:00-20:00");

    solver = new TransitSolver(graph, timeConstraint);
  });

  it("parses 24/7 and day-window opening hours correctly", () => {
    const mondayMorning = new Date("2026-10-12T09:30:00Z"); // Monday
    expect(timeConstraint.isVenueOpenAt("v-start", mondayMorning)).toBe(true);
    expect(timeConstraint.isVenueOpenAt("v-cafe", mondayMorning)).toBe(true);
  });

  it("solves TSPTW and outputs optimal visitation sequence and schedule", () => {
    // Start Monday 08:30 AM
    const startTime = new Date("2026-10-12T08:30:00");

    const solution = solver.solve("v-start", ["v-cafe", "v-hub"], startTime);

    expect(solution).not.toBeNull();
    expect(solution!.sequence).toEqual(["v-start", "v-cafe", "v-hub"]);
    expect(solution!.totalDurationMinutes).toBeGreaterThan(0);
    expect(solution!.schedule).toHaveLength(3);
    expect(solution!.schedule[0].venueId).toBe("v-start");
    expect(solution!.schedule[1].venueId).toBe("v-cafe");
    expect(solution!.schedule[2].venueId).toBe("v-hub");
  });
});
