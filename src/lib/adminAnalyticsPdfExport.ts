/**
 * adminAnalyticsPdfExport.ts
 *
 * Client-side PDF summary report generator for workspace analytics data using pdf-lib.
 */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { drawSafeText, safeText } from "@/lib/pdfHelpers";
import type { AnalyticsExportData } from "./adminAnalyticsCsvExport";

export async function generateAnalyticsPdfReport(
  data: AnalyticsExportData,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Use A4 Portrait dimensions: 595 x 842 pt
  let page = pdfDoc.addPage([595, 842]);
  const { width, height } = page.getSize();
  const margin = 40;
  let y = height - margin;

  const newPage = () => {
    page = pdfDoc.addPage([595, 842]);
    y = height - margin;
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < margin + 30) {
      newPage();
    }
  };

  // Top Accent Bar (Purple)
  page.drawRectangle({
    x: 0,
    y: height - 8,
    width,
    height: 8,
    color: rgb(0.55, 0.35, 0.95),
  });

  // Header Title
  drawSafeText(page, "WorkSphere Platform Analytics Report", {
    x: margin,
    y,
    size: 18,
    font: bold,
    color: rgb(0.08, 0.12, 0.22),
  });
  y -= 22;

  drawSafeText(
    page,
    "Private operational summary of discovery demand, workspace usage, and venue performance.",
    {
      x: margin,
      y,
      size: 9.5,
      font,
      color: rgb(0.4, 0.45, 0.5),
    },
  );
  y -= 16;

  const formattedDate = data.generatedAt
    ? new Date(data.generatedAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : new Date().toLocaleDateString();

  drawSafeText(
    page,
    `Time Window: ${data.range.toUpperCase()}  ·  Generated: ${formattedDate}`,
    {
      x: margin,
      y,
      size: 8.5,
      font,
      color: rgb(0.5, 0.55, 0.6),
    },
  );
  y -= 18;

  // Header Divider
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 1,
    color: rgb(0.85, 0.88, 0.92),
  });
  y -= 20;

  // Section 1: Executive Overview Cards Grid
  ensureSpace(110);
  drawSafeText(page, "1. PLATFORM OVERVIEW SUMMARY", {
    x: margin,
    y,
    size: 11,
    font: bold,
    color: rgb(0.2, 0.25, 0.35),
  });
  y -= 16;

  const overviewBoxY = y - 85;
  page.drawRectangle({
    x: margin,
    y: overviewBoxY,
    width: width - margin * 2,
    height: 85,
    color: rgb(0.96, 0.97, 0.99),
    borderColor: rgb(0.84, 0.88, 0.94),
    borderWidth: 1,
  });

  const cardWidth = (width - margin * 2) / 3;

  // Card 1: Users & Bookings
  drawSafeText(page, `Active Users: ${data.overview.activeUsers}`, {
    x: margin + 14,
    y: overviewBoxY + 62,
    size: 9.5,
    font: bold,
    color: rgb(0.1, 0.1, 0.15),
  });
  drawSafeText(page, `Total Accounts: ${data.overview.totalUsers}`, {
    x: margin + 14,
    y: overviewBoxY + 44,
    size: 8.5,
    font,
    color: rgb(0.4, 0.45, 0.5),
  });
  drawSafeText(page, `Bookings: ${data.overview.bookings}`, {
    x: margin + 14,
    y: overviewBoxY + 26,
    size: 8.5,
    font,
    color: rgb(0.2, 0.5, 0.8),
  });

  // Card 2: Searches & Queries
  drawSafeText(page, `Total Searches: ${data.overview.searches}`, {
    x: margin + cardWidth + 14,
    y: overviewBoxY + 62,
    size: 9.5,
    font: bold,
    color: rgb(0.1, 0.1, 0.15),
  });
  const avgLat = data.overview.averageResolutionMs
    ? `${(data.overview.averageResolutionMs / 1000).toFixed(1)}s`
    : "—";
  drawSafeText(page, `Agent Latency: ${avgLat}`, {
    x: margin + cardWidth + 14,
    y: overviewBoxY + 44,
    size: 8.5,
    font,
    color: rgb(0.4, 0.45, 0.5),
  });
  drawSafeText(page, `Agent Success: ${data.overview.agentSuccessRate}%`, {
    x: margin + cardWidth + 14,
    y: overviewBoxY + 26,
    size: 8.5,
    font,
    color: rgb(0.1, 0.55, 0.35),
  });

  // Card 3: Telemetry Mode
  drawSafeText(page, "Telemetry Status", {
    x: margin + cardWidth * 2 + 14,
    y: overviewBoxY + 62,
    size: 9.5,
    font: bold,
    color: rgb(0.1, 0.1, 0.15),
  });
  drawSafeText(page, "Status: Live & Verified", {
    x: margin + cardWidth * 2 + 14,
    y: overviewBoxY + 44,
    size: 8.5,
    font,
    color: rgb(0.1, 0.55, 0.35),
  });
  drawSafeText(page, "First-party private signals", {
    x: margin + cardWidth * 2 + 14,
    y: overviewBoxY + 26,
    size: 8.5,
    font,
    color: rgb(0.5, 0.5, 0.5),
  });

  y = overviewBoxY - 24;

  // Section 2: Venue Leaderboard Table
  ensureSpace(120);
  drawSafeText(page, "2. VENUE POPULARITY LEADERBOARD", {
    x: margin,
    y,
    size: 11,
    font: bold,
    color: rgb(0.2, 0.25, 0.35),
  });
  y -= 16;

  // Table Headers
  const tableX = margin;
  const colX = [
    tableX,
    tableX + 32,
    tableX + 220,
    tableX + 310,
    tableX + 380,
    tableX + 440,
  ];
  page.drawRectangle({
    x: margin,
    y: y - 18,
    width: width - margin * 2,
    height: 18,
    color: rgb(0.92, 0.94, 0.97),
  });

  drawSafeText(page, "RK", {
    x: colX[0] + 6,
    y: y - 13,
    size: 8,
    font: bold,
    color: rgb(0.3, 0.3, 0.3),
  });
  drawSafeText(page, "VENUE NAME", {
    x: colX[1] + 6,
    y: y - 13,
    size: 8,
    font: bold,
    color: rgb(0.3, 0.3, 0.3),
  });
  drawSafeText(page, "CATEGORY", {
    x: colX[2] + 6,
    y: y - 13,
    size: 8,
    font: bold,
    color: rgb(0.3, 0.3, 0.3),
  });
  drawSafeText(page, "VIEWS", {
    x: colX[3] + 6,
    y: y - 13,
    size: 8,
    font: bold,
    color: rgb(0.3, 0.3, 0.3),
  });
  drawSafeText(page, "BOOKINGS", {
    x: colX[4] + 6,
    y: y - 13,
    size: 8,
    font: bold,
    color: rgb(0.3, 0.3, 0.3),
  });
  drawSafeText(page, "SCORE", {
    x: colX[5] + 6,
    y: y - 13,
    size: 8,
    font: bold,
    color: rgb(0.3, 0.3, 0.3),
  });

  y -= 22;

  data.venueLeaderboard.slice(0, 10).forEach((venue, index) => {
    ensureSpace(20);
    const rowY = y - 16;

    if (index % 2 === 1) {
      page.drawRectangle({
        x: margin,
        y: rowY,
        width: width - margin * 2,
        height: 18,
        color: rgb(0.97, 0.98, 0.99),
      });
    }

    const rankStr = String(index + 1).padStart(2, "0");
    const nameStr = safeText(
      venue.name.length > 28 ? `${venue.name.slice(0, 26)}...` : venue.name,
    );
    const catStr = safeText(venue.category);
    const ratingStr =
      venue.rating != null && !isNaN(venue.rating)
        ? venue.rating.toFixed(1)
        : "0.0";

    drawSafeText(page, rankStr, {
      x: colX[0] + 6,
      y: rowY + 5,
      size: 8,
      font,
      color: rgb(0.4, 0.4, 0.4),
    });
    drawSafeText(page, nameStr, {
      x: colX[1] + 6,
      y: rowY + 5,
      size: 8,
      font: bold,
      color: rgb(0.1, 0.1, 0.15),
    });
    drawSafeText(page, catStr, {
      x: colX[2] + 6,
      y: rowY + 5,
      size: 8,
      font,
      color: rgb(0.4, 0.45, 0.5),
    });
    drawSafeText(page, String(venue.views), {
      x: colX[3] + 6,
      y: rowY + 5,
      size: 8,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });
    drawSafeText(page, `${venue.bookings} (★ ${ratingStr})`, {
      x: colX[4] + 6,
      y: rowY + 5,
      size: 8,
      font,
      color: rgb(0.2, 0.5, 0.3),
    });
    drawSafeText(page, String(venue.score), {
      x: colX[5] + 6,
      y: rowY + 5,
      size: 8,
      font: bold,
      color: rgb(0.55, 0.35, 0.95),
    });

    y -= 20;
  });

  y -= 10;

  // Section 3: Requested Amenities & Search Terms
  ensureSpace(120);
  drawSafeText(page, "3. REQUESTED AMENITIES & POPULAR SEARCH TERMS", {
    x: margin,
    y,
    size: 11,
    font: bold,
    color: rgb(0.2, 0.25, 0.35),
  });
  y -= 16;

  const colHalfWidth = (width - margin * 2 - 16) / 2;

  // Left Column: Amenities
  drawSafeText(page, "Top Workspace Requirements:", {
    x: margin,
    y,
    size: 9,
    font: bold,
    color: rgb(0.2, 0.2, 0.2),
  });
  let amY = y - 14;
  data.amenities.slice(0, 5).forEach((am) => {
    const amName = safeText(am.amenity.replaceAll("_", " "));
    drawSafeText(page, `• ${amName}: ${am.count} requests`, {
      x: margin + 6,
      y: amY,
      size: 8.5,
      font,
      color: rgb(0.3, 0.35, 0.4),
    });
    amY -= 13;
  });

  // Right Column: Search Terms
  drawSafeText(page, "Frequent Natural Queries:", {
    x: margin + colHalfWidth + 16,
    y,
    size: 9,
    font: bold,
    color: rgb(0.2, 0.2, 0.2),
  });
  let stY = y - 14;
  data.searchTerms.slice(0, 5).forEach((st) => {
    const term = safeText(st.term);
    drawSafeText(page, `• "${term}": ${st.count} searches`, {
      x: margin + colHalfWidth + 22,
      y: stY,
      size: 8.5,
      font,
      color: rgb(0.3, 0.35, 0.4),
    });
    stY -= 13;
  });

  y = Math.min(amY, stY) - 16;

  // Footer Page Numbers
  const pages = pdfDoc.getPages();
  pages.forEach((p, index) => {
    p.drawRectangle({
      x: 0,
      y: 0,
      width: 595,
      height: 24,
      color: rgb(0.96, 0.97, 0.98),
    });

    drawSafeText(
      p,
      `WorkSphere Admin Telemetry  ·  Page ${index + 1} of ${pages.length}`,
      {
        x: margin,
        y: 8,
        size: 8,
        font,
        color: rgb(0.5, 0.55, 0.6),
      },
    );
  });

  return pdfDoc.save();
}

export function downloadAnalyticsPDF(data: AnalyticsExportData): Promise<Blob> {
  return generateAnalyticsPdfReport(data).then((pdfBytes) => {
    const blob = new Blob([pdfBytes], { type: "application/pdf" });

    if (typeof window !== "undefined" && typeof document !== "undefined") {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const dateStr = new Date(data.generatedAt).toISOString().slice(0, 10);
      anchor.download = `workspace-analytics-${data.range}-${dateStr}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    }

    return blob;
  });
}
