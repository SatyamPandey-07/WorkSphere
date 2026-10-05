/**
 * Analytics Exporter (CSV and PDF).
 *
 * Implements standard builders for exporting workspace metrics and venue leaderboards.
 */

import { CsvBuilder, escapeCSVField } from "../csvBuilder";
import {
  PdfDocumentBuilder,
  drawSafeText,
  safeText,
  truncateText,
} from "../pdfBuilder";
import { rgb } from "pdf-lib";

export interface AnalyticsMetric {
  timestamp: string | Date;
  visitorCount: number;
  checkIns: number;
  meanDecibelLevel: number;
}

export interface AnalyticsExportData {
  range: string;
  generatedAt: string;
  overview: {
    activeUsers: number;
    totalUsers: number;
    searches: number;
    bookings: number;
    averageResolutionMs: number;
    agentSuccessRate: number;
  };
  searchTerms: Array<{ term: string; count: number }>;
  amenities: Array<{ amenity: string; count: number }>;
  venueLeaderboard: Array<{
    id: string;
    name: string;
    category: string;
    views: number;
    bookings: number;
    rating: number;
    score: number;
  }>;
  bookingTrend: Array<{ date: string; bookings: number }>;
  ratingTrend: Array<{ date: string; rating: number | null }>;
}

export function exportAnalyticsToCSV(data: AnalyticsMetric[]): string {
  const builder = new CsvBuilder<AnalyticsMetric>({ lineDelimiter: "\r\n" });
  builder.setColumns([
    {
      header: "Timestamp",
      accessor: (m) =>
        m.timestamp instanceof Date ? m.timestamp.toISOString() : (m.timestamp ?? ""),
    },
    { header: "Visitor Count", accessor: (m) => m.visitorCount ?? 0 },
    { header: "Check Ins", accessor: (m) => m.checkIns ?? 0 },
    { header: "Mean Decibel Level", accessor: (m) => m.meanDecibelLevel ?? 0 },
  ]);

  if (Array.isArray(data)) {
    builder.addRows(data);
  }

  return builder.build();
}

export function downloadAnalyticsCSV(
  data: AnalyticsMetric[] | AnalyticsExportData,
  filename?: string,
): Blob {
  const isStructured = "overview" in data;
  const today = new Date().toISOString().slice(0, 10);
  const downloadFileName = filename || `worksphere-analytics-${today}.csv`;

  if (isStructured) {
    const csvContent = generateAnalyticsCSV(data as AnalyticsExportData);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const builder = new CsvBuilder();
    return builder.download.call({ toBlob: () => blob }, downloadFileName);
  } else {
    const builder = new CsvBuilder<AnalyticsMetric>({ lineDelimiter: "\r\n" });
    builder.setColumns([
      {
        header: "Timestamp",
        accessor: (m) =>
          m.timestamp instanceof Date ? m.timestamp.toISOString() : (m.timestamp ?? ""),
      },
      { header: "Visitor Count", accessor: (m) => m.visitorCount ?? 0 },
      { header: "Check Ins", accessor: (m) => m.checkIns ?? 0 },
      { header: "Mean Decibel Level", accessor: (m) => m.meanDecibelLevel ?? 0 },
    ]);
    builder.addRows(data as AnalyticsMetric[]);
    return builder.download(downloadFileName);
  }
}

export function generateAnalyticsCSV(data: AnalyticsExportData): string {
  const builder = new CsvBuilder({ lineDelimiter: "\n" });

  // Section 1: Overview Summary
  builder.addSectionHeader("WORKSPACE ANALYTICS OVERVIEW");
  builder.addRawLine(`Time Window,${escapeCSVField(data.range)}`);
  builder.addRawLine(`Generated At,${escapeCSVField(data.generatedAt)}`);
  builder.addRawLine(`Active Users,${data.overview.activeUsers}`);
  builder.addRawLine(`Total Accounts,${data.overview.totalUsers}`);
  builder.addRawLine(`Search Queries,${data.overview.searches}`);
  builder.addRawLine(`Total Bookings,${data.overview.bookings}`);
  builder.addRawLine(
    `Avg Agent Latency (ms),${data.overview.averageResolutionMs}`,
  );
  builder.addRawLine(
    `Agent Success Rate (%),${data.overview.agentSuccessRate}`,
  );
  builder.addBlankLine();

  // Section 2: Venue Leaderboard
  builder.addSectionHeader("VENUE POPULARITY LEADERBOARD");
  builder.addRawLine("Rank,Venue ID,Venue Name,Category,Views,Bookings,Rating,Score");
  data.venueLeaderboard.forEach((v, index) => {
    const cleanName = escapeCSVField(v.name);
    const ratingStr =
      v.rating != null && !isNaN(v.rating) ? v.rating.toFixed(1) : "0.0";
    builder.addRawLine(
      `${index + 1},${v.id},${cleanName},${escapeCSVField(v.category)},${v.views},${v.bookings},${ratingStr},${v.score}`,
    );
  });
  builder.addBlankLine();

  // Section 3: Daily Trends & Check-ins
  builder.addSectionHeader("DAILY BOOKINGS & RATING TRENDS");
  builder.addRawLine("Date,Bookings,Average Rating");
  const trendDates = Array.from(
    new Set([
      ...data.bookingTrend.map((b) => b.date),
      ...data.ratingTrend.map((r) => r.date),
    ]),
  ).sort();

  trendDates.forEach((date) => {
    const bMatch = data.bookingTrend.find((b) => b.date === date);
    const rMatch = data.ratingTrend.find((r) => r.date === date);
    const bookings = bMatch ? bMatch.bookings : 0;
    const rating =
      rMatch && rMatch.rating != null ? rMatch.rating.toFixed(1) : "N/A";
    builder.addRawLine(`${date},${bookings},${rating}`);
  });
  builder.addBlankLine();

  // Section 4: Requested Amenities
  builder.addSectionHeader("REQUESTED AMENITIES");
  builder.addRawLine("Amenity,Count");
  data.amenities.forEach((a) => {
    builder.addRawLine(`${escapeCSVField(a.amenity)},${a.count}`);
  });
  builder.addBlankLine();

  // Section 5: Top Search Terms
  builder.addSectionHeader("TOP SEARCH TERMS");
  builder.addRawLine("Search Term,Count");
  data.searchTerms.forEach((s) => {
    builder.addRawLine(`${escapeCSVField(s.term)},${s.count}`);
  });

  return builder.build();
}

export async function generateAnalyticsPdfReport(
  data: AnalyticsExportData,
): Promise<Uint8Array> {
  const pdfBuilder = await PdfDocumentBuilder.create({
    accentColor: { r: 0.55, g: 0.35, b: 0.95 },
    margin: 40,
    title: "WorkSphere Platform Analytics Report",
  });

  const { boldFont, font } = pdfBuilder;
  const margin = pdfBuilder.margin;

  // Header Title
  pdfBuilder.drawHeading(
    "WorkSphere Platform Analytics Report",
    "Private operational summary of discovery demand, workspace usage, and venue performance.",
    { color: rgb(0.08, 0.12, 0.22) },
  );

  pdfBuilder.drawText(
    `Window: ${data.range}   ·   Generated: ${data.generatedAt}`,
    { size: 9, color: rgb(0.38, 0.44, 0.54) },
  );

  pdfBuilder.drawDivider();

  // Metric Cards
  const cards = [
    { label: "Active Users", value: String(data.overview.activeUsers) },
    { label: "Total Bookings", value: String(data.overview.bookings) },
    { label: "Search Queries", value: String(data.overview.searches) },
    { label: "Agent Success", value: `${data.overview.agentSuccessRate}%` },
  ];

  const cardWidth = 115;
  const cardHeight = 44;
  cards.forEach((card, idx) => {
    const x = margin + idx * (cardWidth + 12);
    pdfBuilder.currentPage.drawRectangle({
      x,
      y: pdfBuilder.currentY - cardHeight,
      width: cardWidth,
      height: cardHeight,
      color: rgb(0.96, 0.97, 0.99),
      borderColor: rgb(0.88, 0.91, 0.96),
      borderWidth: 1,
    });

    drawSafeText(pdfBuilder.currentPage, card.label, {
      x: x + 8,
      y: pdfBuilder.currentY - 16,
      size: 8,
      font: boldFont,
      color: rgb(0.4, 0.45, 0.55),
    });

    drawSafeText(pdfBuilder.currentPage, card.value, {
      x: x + 8,
      y: pdfBuilder.currentY - 34,
      size: 14,
      font: boldFont,
      color: rgb(0.1, 0.14, 0.22),
    });
  });

  pdfBuilder.currentY -= cardHeight + 24;

  // Venue Leaderboard
  pdfBuilder.ensureSpace(120);
  pdfBuilder.drawHeading("Top Venues by Performance", undefined, {
    titleSize: 13,
  });

  data.venueLeaderboard.slice(0, 5).forEach((v, i) => {
    pdfBuilder.ensureSpace(20);
    const rowText = `${i + 1}. ${truncateText(v.name, boldFont, 10, 200)} (${v.category}) — ${v.views} views, ${v.bookings} bookings, ★ ${v.rating.toFixed(1)}`;
    pdfBuilder.drawText(rowText, { size: 9, font });
  });

  pdfBuilder.currentY -= 12;

  // Top Amenities & Search Terms
  pdfBuilder.ensureSpace(100);
  pdfBuilder.drawHeading("Popular Amenities & Search Demand", undefined, {
    titleSize: 13,
  });

  const amenitiesSummary = data.amenities
    .slice(0, 6)
    .map((a) => `${a.amenity} (${a.count})`)
    .join("  ·  ");
  pdfBuilder.drawText(`Top Amenities: ${amenitiesSummary || "None"}`, {
    size: 9,
    font,
  });

  const searchSummary = data.searchTerms
    .slice(0, 6)
    .map((s) => `"${s.term}" (${s.count})`)
    .join("  ·  ");
  pdfBuilder.drawText(`Top Searches: ${searchSummary || "None"}`, {
    size: 9,
    font,
  });

  pdfBuilder.addPageNumbers();
  return await pdfBuilder.build();
}
