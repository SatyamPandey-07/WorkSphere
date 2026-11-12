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
  const safeCity = typeof city === "string" ? city.trim() : "";
  const safeVenues = Array.isArray(venues) ? venues : [];

  const cityLower = safeCity.toLowerCase();
  const cityVenues = safeVenues.filter((v) => {
    if (!v || !cityLower) return false;
    const addr =
      typeof v.address === "string"
        ? v.address
        : v.address != null
          ? String(v.address)
          : "";
    return addr.toLowerCase().includes(cityLower);
  });

  const wifiSpeeds = cityVenues
    .map((v) => v?.wifiSpeed)
    .filter((s): s is number => typeof s === "number" && Number.isFinite(s) && s > 0);
  const avgWifiSpeed =
    wifiSpeeds.length > 0
      ? Math.round(wifiSpeeds.reduce((a, b) => a + b, 0) / wifiSpeeds.length)
      : 0;

  const outletCount = cityVenues.filter((v) => Boolean(v?.hasOutlets)).length;
  const quietCount = cityVenues.filter(
    (v) => typeof v?.noiseLevel === "string" && v.noiseLevel.toLowerCase() === "quiet",
  ).length;

  const outletRatio =
    cityVenues.length > 0
      ? Math.round((outletCount / cityVenues.length) * 100)
      : 0;

  return {
    city: safeCity || "Unknown City",
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

export async function generateMultiCityPdfReport(options?: {
  selectedCities?: string[];
  venues?: Venue[];
}): Promise<Uint8Array> {
  const safeOptions = options || {};
  const selectedCities = Array.isArray(safeOptions.selectedCities)
    ? safeOptions.selectedCities.filter(
        (c): c is string => typeof c === "string" && c.trim().length > 0,
      )
    : [];
  const venues = Array.isArray(safeOptions.venues) ? safeOptions.venues : [];

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

  if (selectedCities.length === 0) {
    builder.ensureSpace(60);
    builder.drawText("No city hubs selected for comparison.", {
      size: 11,
      font: boldFont,
      color: rgb(0.5, 0.5, 0.5),
    });
    builder.addPageNumbers();
    return await builder.build();
  }

  const cityMetrics = selectedCities.map((city) =>
    computeCityMetrics(city, venues),
  );

  // Multi-row grid layout: max 4 cards per row to fit within landscape page margins
  const maxColsPerRow = 4;
  const colGap = 16;
  const rowGap = 20;
  const cardHeight = 140;

  for (let i = 0; i < cityMetrics.length; i += maxColsPerRow) {
    const chunk = cityMetrics.slice(i, i + maxColsPerRow);
    builder.ensureSpace(cardHeight + rowGap);

    const colsInRow = chunk.length;
    const colsToFit =
      cityMetrics.length <= maxColsPerRow ? colsInRow : maxColsPerRow;
    const colWidth =
      (availableWidth - colGap * (colsToFit - 1)) / colsToFit;
    const rowY = builder.currentY;

    chunk.forEach((metric, colIndex) => {
      const colX = margin + colIndex * (colWidth + colGap);
      const colY = rowY;

      // Card background
      builder.currentPage.drawRectangle({
        x: colX,
        y: colY - cardHeight,
        width: colWidth,
        height: cardHeight,
        color: rgb(0.96, 0.97, 0.99),
        borderColor: rgb(0.85, 0.88, 0.94),
        borderWidth: 1,
      });

      const safeCityTitle = metric.city.toUpperCase();
      const truncatedTitle = truncateText(
        safeCityTitle,
        boldFont,
        13,
        colWidth - 20,
      );
      drawSafeText(builder.currentPage, truncatedTitle, {
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

    builder.currentY -= cardHeight + rowGap;
  }

  builder.addPageNumbers();
  return await builder.build();
}
