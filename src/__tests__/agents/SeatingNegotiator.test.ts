import {
  SeatingNegotiator,
  type Seat,
  type NomadAgent,
} from "@/core/agents/negotiation/SeatingNegotiator";

describe("SeatingNegotiator (Group Seating Concession Protocol)", () => {
  let negotiator: SeatingNegotiator;

  beforeEach(() => {
    negotiator = new SeatingNegotiator({
      maxRounds: 3,
      defaultConcessionRate: 0.2,
    });
  });

  const sampleSeats: Seat[] = [
    {
      id: "desk-1",
      label: "Window & Power",
      x: 0,
      y: 0,
      hasPower: true,
      hasWindowLight: true,
      isQuietZone: false,
    },
    {
      id: "desk-2",
      label: "Window Only",
      x: 1,
      y: 0,
      hasPower: false,
      hasWindowLight: true,
      isQuietZone: false,
    },
    {
      id: "desk-3",
      label: "Power Only",
      x: 0,
      y: 1,
      hasPower: true,
      hasWindowLight: false,
      isQuietZone: false,
    },
    {
      id: "desk-4",
      label: "Quiet & Power",
      x: 1,
      y: 1,
      hasPower: true,
      hasWindowLight: false,
      isQuietZone: true,
    },
    {
      id: "desk-5",
      label: "Quiet Desk",
      x: 4,
      y: 4,
      hasPower: false,
      hasWindowLight: false,
      isQuietZone: true,
    },
  ];

  describe("Utility Scoring", () => {
    it("calculates agent utility based on matched preferences", () => {
      const agent: NomadAgent = {
        agentId: "agent-power",
        name: "Power User",
        preferences: {
          powerProximity: 1.0,
          windowLight: 0.0,
          quietZone: 0.0,
          groupClustering: 0.5,
        },
      };

      const utilityWithPower = negotiator.calculateUtility(
        agent,
        sampleSeats[0],
      );
      const utilityWithoutPower = negotiator.calculateUtility(
        agent,
        sampleSeats[1],
      );

      expect(utilityWithPower).toBeGreaterThan(utilityWithoutPower);
    });
  });

  describe("2-Agent Seating Negotiation", () => {
    it("reconciles different preferences and assigns distinct cluster seats", () => {
      const agentA: NomadAgent = {
        agentId: "agent-window",
        name: "Photographer",
        preferences: {
          powerProximity: 0.2,
          windowLight: 1.0,
          quietZone: 0.1,
          groupClustering: 0.5,
        },
      };

      const agentB: NomadAgent = {
        agentId: "agent-power",
        name: "Developer",
        preferences: {
          powerProximity: 1.0,
          windowLight: 0.1,
          quietZone: 0.2,
          groupClustering: 0.5,
        },
      };

      const result = negotiator.negotiate(sampleSeats, [agentA, agentB]);

      expect(result.converged).toBe(true);
      expect(result.totalRounds).toBeGreaterThanOrEqual(1);

      // Verify distinct assignments
      const seatA = result.assignments["agent-window"];
      const seatB = result.assignments["agent-power"];
      expect(seatA).toBeDefined();
      expect(seatB).toBeDefined();
      expect(seatA).not.toBe(seatB);

      // Verify utility
      expect(result.individualUtilities["agent-window"]).toBeGreaterThan(0.5);
      expect(result.individualUtilities["agent-power"]).toBeGreaterThan(0.5);
      expect(result.socialWelfare).toBeGreaterThan(1.0);
    });
  });

  describe("3-Agent Negotiation with Conflict Resolution", () => {
    it("detects Round 1 seat conflicts and applies concession rounds", () => {
      // Both Agent 1 and Agent 2 strongly demand desk-1 (the prime window+power desk)
      const agent1: NomadAgent = {
        agentId: "ag-1",
        name: "Founder",
        preferences: {
          powerProximity: 1.0,
          windowLight: 1.0,
          quietZone: 0.0,
          groupClustering: 0.6,
        },
      };
      const agent2: NomadAgent = {
        agentId: "ag-2",
        name: "Designer",
        preferences: {
          powerProximity: 0.9,
          windowLight: 1.0,
          quietZone: 0.0,
          groupClustering: 0.6,
        },
      };
      const agent3: NomadAgent = {
        agentId: "ag-3",
        name: "Writer",
        preferences: {
          powerProximity: 0.2,
          windowLight: 0.2,
          quietZone: 1.0,
          groupClustering: 0.6,
        },
      };

      const result = negotiator.negotiate(sampleSeats, [
        agent1,
        agent2,
        agent3,
      ]);

      expect(result.converged).toBe(true);
      expect(result.rounds).toHaveLength(3);

      // Round 1 detected the conflict for desk-1
      expect(result.rounds[0].conflictsDetected).toContain("desk-1");

      // Concessions were applied in subsequent rounds
      expect(
        Object.keys(result.rounds[1].concessionsApplied).length,
      ).toBeGreaterThan(0);

      // All 3 agents received unique seats
      const assignedSeatIds = new Set(Object.values(result.assignments));
      expect(assignedSeatIds.size).toBe(3);
    });
  });

  describe("4-Agent Group Cluster Negotiation", () => {
    it("converges on contiguous Pareto-optimal cluster seating", () => {
      const agents: NomadAgent[] = [
        {
          agentId: "nomad-1",
          name: "Alice",
          preferences: {
            powerProximity: 0.8,
            windowLight: 0.7,
            quietZone: 0.3,
            groupClustering: 0.9,
          },
        },
        {
          agentId: "nomad-2",
          name: "Bob",
          preferences: {
            powerProximity: 0.9,
            windowLight: 0.2,
            quietZone: 0.6,
            groupClustering: 0.9,
          },
        },
        {
          agentId: "nomad-3",
          name: "Charlie",
          preferences: {
            powerProximity: 0.3,
            windowLight: 0.9,
            quietZone: 0.4,
            groupClustering: 0.9,
          },
        },
        {
          agentId: "nomad-4",
          name: "Diana",
          preferences: {
            powerProximity: 0.7,
            windowLight: 0.4,
            quietZone: 0.8,
            groupClustering: 0.9,
          },
        },
      ];

      const result = negotiator.negotiate(sampleSeats, agents);

      expect(result.converged).toBe(true);
      expect(Object.keys(result.assignments)).toHaveLength(4);

      // Desks 1, 2, 3, 4 form a tight 2x2 grid (x: 0..1, y: 0..1), avoiding isolated desk-5 (x:4, y:4)
      const assigned = Object.values(result.assignedSeats);
      expect(assigned.map((s) => s.id)).toEqual(
        expect.arrayContaining(["desk-1", "desk-2", "desk-3", "desk-4"]),
      );
      expect(result.clusterMetrics.maxInterSeatDistance).toBeLessThanOrEqual(
        Math.SQRT2 + 0.1,
      );
    });

    it("throws error when available seats are insufficient", () => {
      const twoSeats = sampleSeats.slice(0, 2);
      const threeAgents: NomadAgent[] = [
        {
          agentId: "a1",
          name: "A",
          preferences: { powerProximity: 1, windowLight: 0, quietZone: 0, groupClustering: 0.5 },
        },
        {
          agentId: "a2",
          name: "B",
          preferences: { powerProximity: 1, windowLight: 0, quietZone: 0, groupClustering: 0.5 },
        },
        {
          agentId: "a3",
          name: "C",
          preferences: { powerProximity: 1, windowLight: 0, quietZone: 0, groupClustering: 0.5 },
        },
      ];

      expect(() => negotiator.negotiate(twoSeats, threeAgents)).toThrow(
        /insufficient available seats/i,
      );
    });
  });
});
