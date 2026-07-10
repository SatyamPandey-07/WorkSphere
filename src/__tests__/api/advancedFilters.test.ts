import { venueSearchSchema, venueRatingSchema } from "@/lib/validations";

describe("Advanced Workspace Filters validations", () => {
  describe("venueSearchSchema (Search Parameters Parsing)", () => {
    it("should parse boolean ergonomic filter properly", () => {
      const result = venueSearchSchema.safeParse({
        lat: "35.6762",
        lng: "139.6503",
        radius: "1000",
        ergonomic: "true",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.ergonomic).toBe(true);
      }
    });

    it("should accept valid outlet density bands", () => {
      const densities = ["every_table", "some_tables", "wall_seats", "none"];
      densities.forEach((density) => {
        const result = venueSearchSchema.safeParse({
          lat: "35.6762",
          lng: "139.6503",
          radius: "1000",
          outletDensity: density,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.outletDensity).toBe(density);
        }
      });
    });

    it("should reject invalid outlet density bands", () => {
      const result = venueSearchSchema.safeParse({
        lat: "35.6762",
        lng: "139.6503",
        radius: "1000",
        outletDensity: "invalid_value",
      });
      expect(result.success).toBe(false);
    });

    it("should accept valid wifi speed bands", () => {
      const bands = ["basic", "fast", "ultra", "all"];
      bands.forEach((band) => {
        const result = venueSearchSchema.safeParse({
          lat: "35.6762",
          lng: "139.6503",
          radius: "1000",
          wifiSpeedBand: band,
        });
        expect(result.success).toBe(true);
        if (result.success) {
          expect(result.data.wifiSpeedBand).toBe(band);
        }
      });
    });
  });

  describe("venueRatingSchema (Submission validation rules)", () => {
    it("should validate and coerce ratings fields successfully", () => {
      const result = venueRatingSchema.safeParse({
        wifiQuality: 4,
        hasOutlets: true,
        noiseLevel: "quiet",
        hasErgonomic: true,
        outletDensity: "every_table",
        wifiSpeed: 75,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasErgonomic).toBe(true);
        expect(result.data.outletDensity).toBe("every_table");
        expect(result.data.wifiSpeed).toBe(75);
      }
    });

    it("should set defaults for ergonomic option if not provided", () => {
      const result = venueRatingSchema.safeParse({
        wifiQuality: 3,
        hasOutlets: false,
        noiseLevel: "moderate",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasErgonomic).toBe(false);
        expect(result.data.outletDensity).toBe("none");
        expect(result.data.wifiSpeed).toBeUndefined();
      }
    });
  });

  describe("DB Rating aggregates calculation logic simulation", () => {
    it("should calculate correct average speed, dominant density and ergonomic percentages", () => {
      // Mock ratings array simulating allRatings in route.ts
      const allRatings = [
        { wifiSpeed: 80, outletDensity: "every_table", hasErgonomic: true },
        { wifiSpeed: 120, outletDensity: "every_table", hasErgonomic: false },
        { wifiSpeed: null, outletDensity: "some_tables", hasErgonomic: true },
        { wifiSpeed: 0, outletDensity: "every_table", hasErgonomic: true },
      ];

      // Wi-Fi Speed Average (ignoring null and 0 values)
      const validSpeeds = allRatings
        .filter((r) => r.wifiSpeed !== null && r.wifiSpeed > 0)
        .map((r) => r.wifiSpeed as number);
      
      const avgSpeed = validSpeeds.length > 0
        ? Math.round(validSpeeds.reduce((sum, s) => sum + s, 0) / validSpeeds.length)
        : null;

      expect(avgSpeed).toBe(100); // (80 + 120) / 2 = 100

      // Outlet Density Dominant Mode
      const densityCounts: Record<string, number> = {};
      allRatings.forEach((r) => {
        if (r.outletDensity) {
          densityCounts[r.outletDensity] = (densityCounts[r.outletDensity] || 0) + 1;
        }
      });
      const dominantDensity = Object.keys(densityCounts).length > 0
        ? Object.entries(densityCounts).reduce((a, b) => b[1] > a[1] ? b : a)[0]
        : "none";

      expect(dominantDensity).toBe("every_table"); // 3 votes for every_table vs 1 for some_tables

      // Ergonomic percentage (> 50%)
      const ergonomicPct = (allRatings.filter((r) => r.hasErgonomic).length / allRatings.length) * 100;
      expect(ergonomicPct).toBe(75); // 3 of 4 is 75%
      expect(ergonomicPct > 50).toBe(true);
    });
  });

  describe("Post-Enrichment Filtering Logic Simulation", () => {
    const sampleEnrichedVenues = [
      { id: "1", name: "Cafe A", wifiSpeed: 80, outletDensity: "every_table", hasErgonomic: true, wifi: true, hasOutlets: true, noiseLevel: "quiet" },
      { id: "2", name: "Cafe B", wifiSpeed: 30, outletDensity: "some_tables", hasErgonomic: false, wifi: true, hasOutlets: true, noiseLevel: "moderate" },
      { id: "3", name: "Cafe C", wifiSpeed: null, outletDensity: "none", hasErgonomic: false, wifi: false, hasOutlets: false, noiseLevel: "loud" },
    ];

    it("should filter venues correctly by ergonomic status", () => {
      const filtered = sampleEnrichedVenues.filter((v) => v.hasErgonomic);
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe("Cafe A");
    });

    it("should filter venues correctly by outlet density threshold", () => {
      // filters: { outletDensity: "some_tables" } -> should match "some_tables" and "every_table"
      const matchingDensity = ["every_table", "some_tables"];
      const filtered = sampleEnrichedVenues.filter((v) => matchingDensity.includes(v.outletDensity));
      expect(filtered.length).toBe(2);
    });

    it("should filter venues correctly by wifi speed band", () => {
      // filters: { wifiSpeedBand: "fast" } -> speed >= 50
      const filtered = sampleEnrichedVenues.filter((v) => v.wifiSpeed !== null && v.wifiSpeed >= 50);
      expect(filtered.length).toBe(1);
      expect(filtered[0].name).toBe("Cafe A");
    });
  });
});
