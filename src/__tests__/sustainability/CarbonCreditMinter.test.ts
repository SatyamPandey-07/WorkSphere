import {
  calculateSavedCarbon,
  CarbonCreditMinter,
  CAR_BASELINE_G_PER_KM,
  ECO_NOMAD_BADGES,
} from "@/core/sustainability/CarbonCreditMinter";

describe("CarbonCreditMinter Sustainability Engine", () => {
  describe("calculateSavedCarbon", () => {
    it("compares transit modes against standard car baseline (170g/km)", () => {
      expect(CAR_BASELINE_G_PER_KM).toBe(170);

      // Bicycle (0g/km) on 10km commute saves full 1,700g CO2
      const bikeSaved = calculateSavedCarbon(10, "bicycle");
      expect(bikeSaved).toBe(1700);

      // Walking (0g/km) on 5km commute saves 850g CO2
      const walkSaved = calculateSavedCarbon(5, "walking");
      expect(walkSaved).toBe(850);
    });

    it("calculates emissions saved for public transit and train", () => {
      // Public transit (40g/km): 10km * (170 - 40) = 1,300g saved
      const transitSaved = calculateSavedCarbon(10, "public_transit");
      expect(transitSaved).toBe(1300);

      // Train (30g/km): 20km * (170 - 30) = 2,800g saved
      const trainSaved = calculateSavedCarbon(20, "train");
      expect(trainSaved).toBe(2800);
    });

    it("returns 0g saved when choosing rideshare or personal car", () => {
      const rideshareSaved = calculateSavedCarbon(15, "rideshare");
      expect(rideshareSaved).toBe(0);

      const carSaved = calculateSavedCarbon(15, "car");
      expect(carSaved).toBe(0);
    });

    it("handles zero, negative, or invalid distances safely", () => {
      expect(calculateSavedCarbon(0, "bicycle")).toBe(0);
      expect(calculateSavedCarbon(-5, "bicycle")).toBe(0);
      expect(calculateSavedCarbon(NaN, "bicycle")).toBe(0);
    });
  });

  describe("mintCarbonCreditEvent & User Streak Integration", () => {
    let minter: CarbonCreditMinter;

    beforeEach(() => {
      minter = new CarbonCreditMinter();
    });

    it("mints carbon credit events and awards gamified eco-points", () => {
      const event = minter.mintCarbonCreditEvent("user-nomad-1", 10, "bicycle");

      expect(event.userId).toBe("user-nomad-1");
      expect(event.gramsSaved).toBe(1700);
      expect(event.ecoPointsAwarded).toBe(17); // 1700g / 100g per point
      expect(event.newTotalGramsSaved).toBe(1700);
      expect(event.newTotalEcoPoints).toBe(17);
    });

    it("unlocks Eco-Nomad badges when cumulative CO2 savings cross milestones", () => {
      // 1st Commute: 2 km on bike saves 340g (no badge yet, first milestone is 500g)
      const event1 = minter.mintCarbonCreditEvent("user-nomad-2", 2, "bicycle");
      expect(event1.newlyUnlockedBadges).toHaveLength(0);

      // 2nd Commute: 2 km on bike saves additional 340g (total: 680g -> unlocks First Green Mile)
      const event2 = minter.mintCarbonCreditEvent("user-nomad-2", 2, "bicycle");
      expect(event2.newlyUnlockedBadges).toHaveLength(1);
      expect(event2.newlyUnlockedBadges[0].id).toBe("first_green_mile");

      // Verify profile persistence
      const profile = minter.getUserProfile("user-nomad-2");
      expect(profile.sustainableCommutesCount).toBe(2);
      expect(profile.unlockedBadgeIds).toContain("first_green_mile");
    });

    it("accumulates multiple transit sessions into user eco streak database", () => {
      minter.mintCarbonCreditEvent("user-nomad-3", 10, "bicycle"); // 1700g, 17 pts
      minter.mintCarbonCreditEvent("user-nomad-3", 10, "public_transit"); // 1300g, 13 pts

      const profile = minter.getUserProfile("user-nomad-3");
      expect(profile.totalGramsSaved).toBe(3000);
      expect(profile.totalEcoPoints).toBe(30);
      expect(profile.sustainableCommutesCount).toBe(2);
      // 3000g unlocks "first_green_mile" (500g) and "bronze_pedaler" (2500g)
      expect(profile.unlockedBadgeIds).toEqual(
        expect.arrayContaining(["first_green_mile", "bronze_pedaler"])
      );
    });
  });
});
