import {
  computeCityMetrics,
  generateMultiCityPdfReport,
} from "@/lib/multiCityPdfExport";
import { Venue } from "@/components/chat/ChatMessages";
import { PDFDocument } from "pdf-lib";

const mockVenues: Venue[] = [
  {
    id: "v1",
    name: "San Francisco Cowork",
    address: "Market St, San Francisco, CA",
    lat: 37.7749,
    lng: -122.4194,
    category: "coworking",
    wifiSpeed: 150,
    hasOutlets: true,
    noiseLevel: "quiet",
  },
  {
    id: "v2",
    name: "SF Quiet Hub",
    address: "Mission St, San Francisco, CA",
    lat: 37.7749,
    lng: -122.4194,
    category: "cafe",
    wifiSpeed: 100,
    hasOutlets: true,
    noiseLevel: "quiet",
  },
  {
    id: "v3",
    name: "Tokyo Cafe",
    address: "Shibuya, Tokyo",
    lat: 35.6762,
    lng: 139.6503,
    category: "cafe",
    wifiSpeed: 200,
    hasOutlets: false,
    noiseLevel: "moderate",
  },
];

describe("MultiCity PDF Export Utility (src/lib/multiCityPdfExport.ts)", () => {
  it("correctly computes city metrics for Wi-Fi speed, quiet ratio, and outlet density", () => {
    const sfMetrics = computeCityMetrics("San Francisco", mockVenues);
    expect(sfMetrics.totalVenues).toBe(2);
    expect(sfMetrics.avgWifiSpeed).toBe(125);
    expect(sfMetrics.quietRatio).toBe(100);
    expect(sfMetrics.outletDensityPct).toBe(100);
  });

  it("handles empty venue arrays gracefully", () => {
    const emptyMetrics = computeCityMetrics("Unknown City", []);
    expect(emptyMetrics.totalVenues).toBe(0);
    expect(emptyMetrics.avgWifiSpeed).toBe(0);
    expect(emptyMetrics.quietRatio).toBe(0);
    expect(emptyMetrics.outletDensityPct).toBe(0);
  });

  it("generates a valid binary PDF document given multiple selected cities", async () => {
    const pdfBytes = await generateMultiCityPdfReport({
      selectedCities: ["San Francisco", "Tokyo"],
      venues: mockVenues,
    });

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(100);

    const doc = await PDFDocument.load(pdfBytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
