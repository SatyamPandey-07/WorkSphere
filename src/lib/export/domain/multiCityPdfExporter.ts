/**
 * Multi-City Comparison Exporter (PDF).
 *
 * Implements landscape comparison PDF document generation for multi-city nomad workspace analytics.
 */

import {
  PdfDocumentBuilder,
  drawSafeText,
  safeText,
  truncateText,
} from "../pdfBuilder";
import { rgb, StandardFonts, PDFDocument } from "pdf-lib";
import { Venue } from "@/components/chat/ChatMessages";

export { truncateText };

export interface CityMetricSummary {
  city: string;
  totalVenues: number;
  avgWifiSpeed: number | null;
  quietRatio: number;
  outletRatio: number;
  outletDensityPct: number;
  venues: Venue[];
}

export function computeCityMetrics(
  city: string,
  venues: Venue[],
): CityMetricSummary {
  const cityVenues = venues.filter(
    (v) => v.address && v.address.toLowerCase().includes(city.toLowerCase()),
  );

  const wifiSpeeds = cityVenues
    .map((v) => v.wifiSpeed)
    .filter((s): s is number => s != null && s > 0);
  const avgWifiSpeed =
    wifiSpeeds.length > 0
      ? Math.round(wifiSpeeds.reduce((a, b) => a + b, 0) / wifiSpeeds.length)
      : 0;

  const outletCount = cityVenues.filter((v) => v.hasOutlets).length;
  const quietCount = cityVenues.filter((v) => v.noiseLevel === "quiet").length;

  const outletRatio =
    cityVenues.length > 0
      ? Math.round((outletCount / cityVenues.length) * 100)
      : 0;

  return {
    city,
    totalVenues: cityVenues.length,
    avgWifiSpeed,
    quietRatio:
      cityVenues.length > 0
        ? Math.round((quietCount / cityVenues.length) * 100)
        : 0,
    outletRatio,
    outletDensityPct: outletRatio,
    venues: cityVenues,
  };
}

export async function generateMultiCityPdfReport(options: {
  selectedCities: string[];
  venues: Venue[];
}): Promise<Uint8Array> {
  const { selectedCities, venues } = options;

  const builder = await PdfDocumentBuilder.create({
    pageSize: [842, 595], // A4 Landscape
    margin: 40,
    accentColor: { r: 0.15, g: 0.45, b: 0.95 },
    title: "WorkSphere Multi-City Nomad Workspace Report",
  });

  const { boldFont, font } = builder;
  const margin = builder.margin;
  const availableWidth = builder.pageWidth - margin * 2;

  // Header Title
  builder.drawHeading(
    "WorkSphere Multi-City Nomad Workspace Report",
    "Side-by-side comparison of Wi-Fi speeds, noise levels, and power outlet density metrics across global nomad hubs.",
    { titleSize: 18, color: rgb(0.08, 0.12, 0.2) },
  );

  builder.drawText(
    `Generated on ${new Date().toLocaleDateString()}  ·  Total hubs compared: ${selectedCities.length}`,
    { size: 9, font, color: rgb(0.4, 0.45, 0.5) },
  );

  builder.drawDivider();

  const cityMetrics = selectedCities.map((city) =>
    computeCityMetrics(city, venues),
  );

  const numCities = cityMetrics.length || 1;
  const colGap = 16;
  const colWidth = Math.max(
    140,
    (availableWidth - colGap * (numCities - 1)) / numCities,
  );

  const startY = builder.currentY;

  // Draw comparison columns side-by-side
  cityMetrics.forEach((metric, index) => {
    const colX = margin + index * (colWidth + colGap);
    const colY = startY;

    // Card background
    builder.currentPage.drawRectangle({
      x: colX,
      y: colY - 140,
      width: colWidth,
      height: 140,
      color: rgb(0.96, 0.97, 0.99),
      borderColor: rgb(0.85, 0.88, 0.94),
      borderWidth: 1,
    });

    drawSafeText(builder.currentPage, metric.city.toUpperCase(), {
      x: colX + 10,
      y: colY - 20,
      size: 13,
      font: boldFont,
      color: rgb(0.1, 0.25, 0.6),
    });

    drawSafeText(
      builder.currentPage,
      `Avg WiFi: ${metric.avgWifiSpeed ? `${metric.avgWifiSpeed} Mbps` : "N/A"}`,
      {
        x: colX + 10,
        y: colY - 45,
        size: 9,
        font,
        color: rgb(0.2, 0.2, 0.2),
      },
    );

    drawSafeText(builder.currentPage, `Quiet Venues: ${metric.quietRatio}%`, {
      x: colX + 10,
      y: colY - 65,
      size: 9,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });

    drawSafeText(builder.currentPage, `Outlets Available: ${metric.outletRatio}%`, {
      x: colX + 10,
      y: colY - 85,
      size: 9,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });

    drawSafeText(
      builder.currentPage,
      `Tracked Workspaces: ${metric.totalVenues}`,
      {
        x: colX + 10,
        y: colY - 105,
        size: 9,
        font: boldFont,
        color: rgb(0.15, 0.15, 0.15),
      },
    );
  });

  builder.addPageNumbers();
  return await builder.build();
}
