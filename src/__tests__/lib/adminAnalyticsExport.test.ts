import {
  generateAnalyticsCSV,
  downloadAnalyticsCSV,
  AnalyticsExportData,
} from "@/lib/adminAnalyticsCsvExport";
import {
  generateAnalyticsPdfReport,
  downloadAnalyticsPDF,
} from "@/lib/adminAnalyticsPdfExport";

const mockAnalyticsData: AnalyticsExportData = {
  range: "30d",
  generatedAt: "2026-07-25T10:00:00.000Z",
  overview: {
    activeUsers: 42,
    totalUsers: 150,
    searches: 320,
    bookings: 85,
    averageResolutionMs: 1450,
    agentSuccessRate: 98,
  },
  searchTerms: [
    { term: "quiet cafe", count: 25 },
    { term: "fast wifi", count: 18 },
  ],
  amenities: [
    { amenity: "high_speed_wifi", count: 40 },
    { amenity: "power_outlets", count: 32 },
  ],
  venueLeaderboard: [
    {
      id: "v-1",
      name: "The Hive Coworking",
      category: "coworking",
      views: 120,
      bookings: 35,
      rating: 4.8,
      score: 95,
    },
    {
      id: "v-2",
      name: "Artisan Coffee Lab",
      category: "cafe",
      views: 85,
      bookings: 20,
      rating: 4.5,
      score: 82,
    },
  ],
  bookingTrend: [
    { date: "2026-07-24", bookings: 12 },
    { date: "2026-07-25", bookings: 15 },
  ],
  ratingTrend: [
    { date: "2026-07-24", rating: 4.6 },
    { date: "2026-07-25", rating: 4.8 },
  ],
};

describe("Client-side Admin Analytics CSV & PDF Export (#1530)", () => {
  beforeAll(() => {
    global.URL.createObjectURL = jest
      .fn()
      .mockReturnValue("blob:http://localhost/mock-blob");
    global.URL.revokeObjectURL = jest.fn();
  });

  describe("CSV Export Generator", () => {
    it("formats check-ins, leaderboard, trends, amenities, and search terms into structured CSV", () => {
      const csvText = generateAnalyticsCSV(mockAnalyticsData);

      expect(csvText).toContain("=== WORKSPACE ANALYTICS OVERVIEW ===");
      expect(csvText).toContain("Active Users,42");
      expect(csvText).toContain("Total Bookings,85");

      expect(csvText).toContain("=== VENUE POPULARITY LEADERBOARD ===");
      expect(csvText).toContain('"The Hive Coworking"');
      expect(csvText).toContain("4.8");

      expect(csvText).toContain("=== DAILY BOOKINGS & RATING TRENDS ===");
      expect(csvText).toContain("2026-07-25,15,4.8");

      expect(csvText).toContain("=== REQUESTED AMENITIES ===");
      expect(csvText).toContain('"high_speed_wifi",40');

      expect(csvText).toContain("=== TOP SEARCH TERMS ===");
      expect(csvText).toContain('"quiet cafe",25');
    });

    it("generates downloadable CSV Blob without throwing", () => {
      const blob = downloadAnalyticsCSV(mockAnalyticsData);

      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toContain("text/csv");
      expect(global.URL.createObjectURL).toHaveBeenCalled();
    });
  });

  describe("PDF Export Generator (pdf-lib)", () => {
    it("generates printable PDF Uint8Array report starting with %PDF magic bytes", async () => {
      const pdfBytes = await generateAnalyticsPdfReport(mockAnalyticsData);

      expect(pdfBytes).toBeInstanceOf(Uint8Array);
      expect(pdfBytes.length).toBeGreaterThan(100);

      // Verify PDF magic header bytes: %PDF- (0x25, 0x50, 0x44, 0x46)
      const headerStr = String.fromCharCode(...pdfBytes.slice(0, 4));
      expect(headerStr).toBe("%PDF");
    });

    it("creates downloadable PDF Blob on download invocation", async () => {
      const blob = await downloadAnalyticsPDF(mockAnalyticsData);

      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe("application/pdf");
      expect(global.URL.createObjectURL).toHaveBeenCalled();
    });
  });
});
