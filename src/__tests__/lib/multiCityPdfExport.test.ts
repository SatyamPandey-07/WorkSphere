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
    wifiSpeed: 150,
    hasOutlets: true,
    noiseLevel: "quiet",
  },
  {
    id: "v2",
    name: "SF Quiet Hub",
    address: "Mission St, San Francisco, CA",
    wifiSpeed: 100,
    hasOutlets: true,
    noiseLevel: "quiet",
  },
  {
    id: "v3",
    name: "Tokyo Cafe",
    address: "Shibuya, Tokyo",
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
    expect(sfMetrics.outletRatio).toBe(100);

    const tokyoMetrics = computeCityMetrics("Tokyo", mockVenues);
    expect(tokyoMetrics.totalVenues).toBe(1);
    expect(tokyoMetrics.avgWifiSpeed).toBe(200);
    expect(tokyoMetrics.quietRatio).toBe(0);
    expect(tokyoMetrics.outletRatio).toBe(0);
  });

  it("generates a valid PDF document containing selected city columns using pdf-lib", async () => {
    const pdfBytes = await generateMultiCityPdfReport({
      selectedCities: ["San Francisco", "Tokyo"],
      venues: mockVenues,
    });

    expect(pdfBytes).toBeInstanceOf(Uint8Array);
    expect(pdfBytes.length).toBeGreaterThan(100);

    // Verify generated PDF document can be re-parsed by pdf-lib
    const parsedPdf = await PDFDocument.load(pdfBytes);
    expect(parsedPdf.getPageCount()).toBeGreaterThanOrEqual(1);

    const firstPage = parsedPdf.getPage(0);
    expect(firstPage.getWidth()).toBe(842); // A4 Landscape width
    expect(firstPage.getHeight()).toBe(595); // A4 Landscape height
  });
});
