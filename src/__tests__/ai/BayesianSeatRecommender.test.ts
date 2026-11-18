import {
  BayesianSeatRecommender,
  createDefaultUserBayesianProfile,
  updateBayesianProfile,
  scoreSeatForUser,
  normalizeAcousticQuietness,
  normalizeLuxBrightness,
  computeBetaDistribution,
  type CheckInEvidence,
  type CandidateSeat,
} from "@/core/ai/BayesianSeatRecommender";

describe("BayesianSeatRecommender (#6470)", () => {
  const userId = "nomad-alex-99";

  describe("Global Priors & Distribution Computation", () => {
    it("computes beta distribution mean and variance correctly", () => {
      const dist = computeBetaDistribution(2.0, 2.0);
      expect(dist.mean).toBe(0.5);
      expect(dist.variance).toBeCloseTo(0.05, 3);
      expect(dist.alpha).toBe(2.0);
      expect(dist.beta).toBe(2.0);
    });

    it("initializes new user profiles with global population priors", () => {
      const profile = createDefaultUserBayesianProfile(userId);
      expect(profile.userId).toBe(userId);
      expect(profile.sessionCount).toBe(0);
      expect(profile.quietPreference.mean).toBe(0.5); // Neutral prior
      expect(profile.sunlightTolerance.mean).toBe(0.5); // Neutral prior
      expect(profile.outletNecessity.mean).toBeGreaterThan(0.6); // Population outlet affinity
      expect(profile.ergonomicPriors.standing).toBeGreaterThan(0);
      expect(profile.ergonomicPriors.ergonomic_chair).toBeGreaterThan(0);
    });

    it("normalizes acoustic dB and lux brightness within sensible boundaries", () => {
      expect(normalizeAcousticQuietness(35)).toBe(1.0); // Ultra quiet
      expect(normalizeAcousticQuietness(75)).toBe(0.0); // Very loud
      expect(normalizeAcousticQuietness(55)).toBe(0.5); // Moderate

      expect(normalizeLuxBrightness(100)).toBe(0.0); // Dim
      expect(normalizeLuxBrightness(1200)).toBe(1.0); // Direct daylight
      expect(normalizeLuxBrightness(650)).toBe(0.5); // Average office
    });
  });

  describe("Bayesian Posterior Convergence (2-3 Sessions)", () => {
    it("converges toward high quiet preference and standing desk affinity for focus worker after 3 sessions", () => {
      let profile = createDefaultUserBayesianProfile(userId);
      const initialQuietVariance = profile.quietPreference.variance;

      // Session 1: Quiet library seat, standing desk, 4 hours, 5 stars
      const session1: CheckInEvidence = {
        seatId: "seat-stand-1",
        rating: 5,
        dwellTimeMinutes: 240,
        acousticDb: 40, // Quiet
        luxLevel: 950, // Bright daylight
        seatErgonomicType: "standing",
        hasOutlet: true,
      };

      // Session 2: Very quiet pod, standing desk, 3 hours, 5 stars
      const session2: CheckInEvidence = {
        seatId: "seat-stand-2",
        rating: 5,
        dwellTimeMinutes: 180,
        acousticDb: 38, // Quiet
        luxLevel: 850,
        seatErgonomicType: "standing",
        hasOutlet: true,
      };

      // Session 3: Noisy cafe desk, standing desk, 45 minutes, 2 stars (disturbed by noise)
      const session3: CheckInEvidence = {
        seatId: "seat-noisy-cafe",
        rating: 2,
        dwellTimeMinutes: 45,
        acousticDb: 72, // Loud cafe -> disliking it reinforces quiet preference
        luxLevel: 600,
        seatErgonomicType: "standing",
        hasOutlet: true,
      };

      profile = updateBayesianProfile(profile, session1);
      profile = updateBayesianProfile(profile, session2);
      profile = updateBayesianProfile(profile, session3);

      expect(profile.sessionCount).toBe(3);

      // Posterior mean for quiet should have increased significantly from initial 0.5
      expect(profile.quietPreference.mean).toBeGreaterThan(0.70);

      // Posterior variance should have shrunk (confidence increased)
      expect(profile.quietPreference.variance).toBeLessThan(initialQuietVariance);

      // Standing desk Dirichlet prior should be highest among ergonomic options
      expect(profile.ergonomicPriors.standing).toBeGreaterThan(
        profile.ergonomicPriors.lounge,
      );
      expect(profile.ergonomicPriors.standing).toBeGreaterThan(
        profile.ergonomicPriors.standard,
      );
    });

    it("adapts toward casual buzz and dim lighting for a creative nomad", () => {
      let profile = createDefaultUserBayesianProfile("creative-user");

      // 3 sessions in bustling lounge with low lighting and no outlet needed
      const sessions: CheckInEvidence[] = [
        {
          seatId: "lounge-1",
          rating: 5,
          dwellTimeMinutes: 200,
          acousticDb: 68, // Lively buzz, 5 stars -> low quiet preference
          luxLevel: 250, // Soft dim light -> low sunlight tolerance
          seatErgonomicType: "lounge",
          hasOutlet: false, // Thrived without outlet
        },
        {
          seatId: "lounge-2",
          rating: 5,
          dwellTimeMinutes: 190,
          acousticDb: 66,
          luxLevel: 200,
          seatErgonomicType: "lounge",
          hasOutlet: false,
        },
        {
          seatId: "glare-desk",
          rating: 2, // Hated bright glare
          dwellTimeMinutes: 30,
          acousticDb: 50,
          luxLevel: 1100, // Very bright window -> low rating reinforces dim light preference
          seatErgonomicType: "standard",
          hasOutlet: true,
        },
      ];

      for (const s of sessions) {
        profile = updateBayesianProfile(profile, s);
      }

      // Quiet preference should decrease below neutral prior (< 0.5)
      expect(profile.quietPreference.mean).toBeLessThan(0.45);

      // Sunlight tolerance should decrease (< 0.40)
      expect(profile.sunlightTolerance.mean).toBeLessThan(0.40);

      // Outlet necessity should drop because user worked long sessions without one
      expect(profile.outletNecessity.mean).toBeLessThan(0.55);

      // Lounge affinity should lead ergonomic options
      expect(profile.ergonomicPriors.lounge).toBeGreaterThan(
        profile.ergonomicPriors.standing,
      );
    });
  });

  describe("Feature Weights & Seat Scoring", () => {
    const candidateSeats: CandidateSeat[] = [
      {
        id: "seat-library-stand",
        name: "Library Standing Desk A1",
        acousticDb: 38,
        luxLevel: 900,
        ergonomicType: "standing",
        hasOutlet: true,
        zoneName: "Quiet Zone",
      },
      {
        id: "seat-cafe-buzz",
        name: "Cafe High Table C3",
        acousticDb: 68,
        luxLevel: 300,
        ergonomicType: "lounge",
        hasOutlet: false,
        zoneName: "Social Cafe",
      },
      {
        id: "seat-booth-private",
        name: "Focus Phone Booth B2",
        acousticDb: 35,
        luxLevel: 500,
        ergonomicType: "booth",
        hasOutlet: true,
        zoneName: "Privacy Hub",
      },
    ];

    it("supports customizable feature weights affecting candidate ranking", () => {
      const profile = createDefaultUserBayesianProfile(userId);

      // Heavily prioritize acoustic quietness
      const quietEvaluation = scoreSeatForUser(
        candidateSeats[0],
        profile,
        {
          acousticWeight: 0.8,
          luxWeight: 0.1,
          ergonomicWeight: 0.05,
          outletWeight: 0.05,
        },
      );

      // Heavily prioritize ergonomic match
      const ergoEvaluation = scoreSeatForUser(
        candidateSeats[0],
        profile,
        {
          acousticWeight: 0.05,
          luxWeight: 0.05,
          ergonomicWeight: 0.8,
          outletWeight: 0.1,
        },
      );

      expect(quietEvaluation.breakdown.acousticMatch).toBeGreaterThan(0.7);
      expect(ergoEvaluation.overallScore).toBeGreaterThan(0);
    });

    it("ranks seats according to converged user posterior preferences", () => {
      const recommender = new BayesianSeatRecommender();

      // Train user toward quiet standing desk preference
      recommender.trainFromHistory(userId, [
        {
          seatId: "hist-1",
          rating: 5,
          dwellTimeMinutes: 240,
          acousticDb: 38,
          luxLevel: 950,
          seatErgonomicType: "standing",
          hasOutlet: true,
        },
        {
          seatId: "hist-2",
          rating: 5,
          dwellTimeMinutes: 210,
          acousticDb: 40,
          luxLevel: 850,
          seatErgonomicType: "standing",
          hasOutlet: true,
        },
      ]);

      const ranked = recommender.recommendSeats(userId, candidateSeats, {
        topK: 3,
      });

      expect(ranked).toHaveLength(3);
      // Library standing desk should rank #1
      expect(ranked[0].seat.id).toBe("seat-library-stand");
      expect(ranked[0].overallScore).toBeGreaterThan(ranked[1].overallScore);
      expect(ranked[0].recommendationReason).toContain("Matches preference");
      expect(ranked[0].confidence).toBeGreaterThan(0.4);
    });
  });
});
