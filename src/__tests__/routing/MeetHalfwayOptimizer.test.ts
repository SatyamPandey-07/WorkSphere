import {
  MeetHalfwayOptimizer,
  resolveEffectiveTransitMode,
  type TeamMemberLocation,
  type CandidateVenue,
} from "@/core/routing/MeetHalfwayOptimizer";

describe("MeetHalfwayOptimizer - Global Transit Preference (#9299)", () => {
  describe("resolveEffectiveTransitMode()", () => {
    describe("when global preference is 'transit'", () => {
      it("always resolves to 'transit' regardless of individual mode", () => {
        expect(resolveEffectiveTransitMode("driving", "transit")).toBe(
          "transit",
        );
        expect(resolveEffectiveTransitMode("bicycling", "transit")).toBe(
          "transit",
        );
        expect(resolveEffectiveTransitMode("walking", "transit")).toBe(
          "transit",
        );
        expect(resolveEffectiveTransitMode("transit", "transit")).toBe(
          "transit",
        );
        expect(resolveEffectiveTransitMode(undefined, "transit")).toBe(
          "transit",
        );
      });
    });

    describe("when global preference is 'walking'", () => {
      it("always resolves to 'walking' regardless of individual mode", () => {
        expect(resolveEffectiveTransitMode("driving", "walking")).toBe(
          "walking",
        );
        expect(resolveEffectiveTransitMode("bicycling", "walking")).toBe(
          "walking",
        );
        expect(resolveEffectiveTransitMode("walking", "walking")).toBe(
          "walking",
        );
        expect(resolveEffectiveTransitMode("transit", "walking")).toBe(
          "walking",
        );
        expect(resolveEffectiveTransitMode(undefined, "walking")).toBe(
          "walking",
        );
      });
    });

    describe("when global preference is 'balanced'", () => {
      it("respects individual member modes and defaults missing modes to 'transit'", () => {
        expect(resolveEffectiveTransitMode("driving", "balanced")).toBe(
          "driving",
        );
        expect(resolveEffectiveTransitMode("bicycling", "balanced")).toBe(
          "bicycling",
        );
        expect(resolveEffectiveTransitMode("walking", "balanced")).toBe(
          "walking",
        );
        expect(resolveEffectiveTransitMode("transit", "balanced")).toBe(
          "transit",
        );
        expect(resolveEffectiveTransitMode(undefined, "balanced")).toBe(
          "transit",
        );
      });
    });

    describe("when global preference is omitted or unspecified", () => {
      it("defaults to 'transit' behavior", () => {
        expect(resolveEffectiveTransitMode("driving")).toBe("transit");
        expect(resolveEffectiveTransitMode("bicycling")).toBe("transit");
        expect(resolveEffectiveTransitMode("walking")).toBe("transit");
        expect(resolveEffectiveTransitMode(undefined)).toBe("transit");
      });
    });
  });

  describe("rankVenuesForTeam()", () => {
    const mockMembers: TeamMemberLocation[] = [
      {
        id: "mem-1",
        name: "Alex",
        latitude: 37.7749,
        longitude: -122.4194,
        transitMode: "driving",
      },
      {
        id: "mem-2",
        name: "Sam",
        latitude: 37.7833,
        longitude: -122.4167,
        transitMode: "bicycling",
      },
      {
        id: "mem-3",
        name: "Jordan",
        latitude: 37.7608,
        longitude: -122.435,
        transitMode: "walking",
      },
      {
        id: "mem-4",
        name: "Taylor",
        latitude: 37.769,
        longitude: -122.446,
        // omitted transitMode
      },
    ];

    const mockVenues: CandidateVenue[] = [
      {
        id: "venue-1",
        name: "Downtown Tech Hub",
        latitude: 37.78,
        longitude: -122.42,
        category: "coworking",
        rating: 4.8,
        wifiSpeed: 200,
        hasOutlets: true,
        maxCapacity: 20,
        currentOccupancy: 5,
        availableSeatsCount: 15,
      },
      {
        id: "venue-2",
        name: "Mission Quiet Corner",
        latitude: 37.76,
        longitude: -122.43,
        category: "cafe",
        rating: 4.5,
        wifiSpeed: 100,
        hasOutlets: false,
        maxCapacity: 10,
        currentOccupancy: 2,
        availableSeatsCount: 8,
      },
    ];

    it("applies 'transit' preference: forces transit mode for all members and reflects in estimates", () => {
      const result = MeetHalfwayOptimizer.rankVenuesForTeam(
        mockMembers,
        mockVenues,
        {
          transitPreference: "transit",
        },
      );

      expect(result.recommendedVenues.length).toBeGreaterThan(0);
      const topRec = result.recommendedVenues[0];

      expect(topRec.memberEstimates).toHaveLength(4);
      topRec.memberEstimates.forEach((estimate) => {
        expect(estimate.transitMode).toBe("transit");
      });
    });

    it("applies 'walking' preference: forces walking mode for all members and increases durations", () => {
      const transitResult = MeetHalfwayOptimizer.rankVenuesForTeam(
        mockMembers,
        mockVenues,
        {
          transitPreference: "transit",
        },
      );
      const walkingResult = MeetHalfwayOptimizer.rankVenuesForTeam(
        mockMembers,
        mockVenues,
        {
          transitPreference: "walking",
        },
      );

      const transitRec = transitResult.recommendedVenues.find(
        (r) => r.venue.id === "venue-1",
      )!;
      const walkingRec = walkingResult.recommendedVenues.find(
        (r) => r.venue.id === "venue-1",
      )!;

      walkingRec.memberEstimates.forEach((estimate) => {
        expect(estimate.transitMode).toBe("walking");
      });

      // Walking speed (4.8 km/h) is ~5x slower than transit (25 km/h), so durations must be longer
      expect(walkingRec.aggregateDurationMinutes).toBeGreaterThan(
        transitRec.aggregateDurationMinutes,
      );
      expect(walkingRec.averageDurationMinutes).toBeGreaterThan(
        transitRec.averageDurationMinutes,
      );
    });

    it("applies 'balanced' preference: preserves individual member modes and defaults missing modes to 'transit'", () => {
      const result = MeetHalfwayOptimizer.rankVenuesForTeam(
        mockMembers,
        mockVenues,
        {
          transitPreference: "balanced",
        },
      );

      const rec = result.recommendedVenues[0];
      const estAlex = rec.memberEstimates.find((e) => e.memberId === "mem-1")!;
      const estSam = rec.memberEstimates.find((e) => e.memberId === "mem-2")!;
      const estJordan = rec.memberEstimates.find(
        (e) => e.memberId === "mem-3",
      )!;
      const estTaylor = rec.memberEstimates.find(
        (e) => e.memberId === "mem-4",
      )!;

      expect(estAlex.transitMode).toBe("driving");
      expect(estSam.transitMode).toBe("bicycling");
      expect(estJordan.transitMode).toBe("walking");
      expect(estTaylor.transitMode).toBe("transit");
    });

    it("defaults to 'transit' when transitPreference is omitted from MeetHalfwayOptions", () => {
      const result = MeetHalfwayOptimizer.rankVenuesForTeam(
        mockMembers,
        mockVenues,
        {
          minRequiredSeats: 2,
        },
      );

      const rec = result.recommendedVenues[0];
      rec.memberEstimates.forEach((estimate) => {
        expect(estimate.transitMode).toBe("transit");
      });
    });

    it("retains backward compatibility when third argument is numeric minRequiredSeats", () => {
      const result = MeetHalfwayOptimizer.rankVenuesForTeam(
        mockMembers,
        mockVenues,
        3,
      );

      expect(result.recommendedVenues).toHaveLength(2);
      const rec = result.recommendedVenues[0];
      rec.memberEstimates.forEach((estimate) => {
        expect(estimate.transitMode).toBe("transit");
      });
    });

    it("retains backward compatibility when third argument is omitted", () => {
      const result = MeetHalfwayOptimizer.rankVenuesForTeam(
        mockMembers,
        mockVenues,
      );

      expect(result.recommendedVenues).toHaveLength(2);
      const rec = result.recommendedVenues[0];
      rec.memberEstimates.forEach((estimate) => {
        expect(estimate.transitMode).toBe("transit");
      });
    });

    it("does not mutate original member objects or input arrays", () => {
      const membersClone = JSON.parse(JSON.stringify(mockMembers));
      const venuesClone = JSON.parse(JSON.stringify(mockVenues));

      MeetHalfwayOptimizer.rankVenuesForTeam(mockMembers, mockVenues, {
        transitPreference: "walking",
      });

      expect(mockMembers).toEqual(membersClone);
      expect(mockVenues).toEqual(venuesClone);
      expect(mockMembers[0].transitMode).toBe("driving");
    });

    it("influences composite rank scores and ranking between different transit preferences", () => {
      const transitResult = MeetHalfwayOptimizer.rankVenuesForTeam(
        mockMembers,
        mockVenues,
        {
          transitPreference: "transit",
        },
      );
      const walkingResult = MeetHalfwayOptimizer.rankVenuesForTeam(
        mockMembers,
        mockVenues,
        {
          transitPreference: "walking",
        },
      );

      const transitTop = transitResult.recommendedVenues[0];
      const walkingTop = walkingResult.recommendedVenues[0];

      // Travel penalties differ due to walking vs transit speed
      expect(walkingTop.compositeRankScore).not.toEqual(
        transitTop.compositeRankScore,
      );
    });

    it("correctly applies transitPreference during fallback capacity relaxation", () => {
      const strictVenues: CandidateVenue[] = [
        {
          id: "venue-tiny",
          name: "Tiny Pod",
          latitude: 37.78,
          longitude: -122.42,
          category: "booth",
          maxCapacity: 2,
          currentOccupancy: 1,
          availableSeatsCount: 1, // less than required 4 seats
        },
      ];

      const result = MeetHalfwayOptimizer.rankVenuesForTeam(
        mockMembers,
        strictVenues,
        {
          minRequiredSeats: 4,
          transitPreference: "walking",
        },
      );

      expect(result.fallbackApplied).toBe(true);
      expect(result.recommendedVenues).toHaveLength(1);
      result.recommendedVenues[0].memberEstimates.forEach((estimate) => {
        expect(estimate.transitMode).toBe("walking");
      });
    });
  });
});
