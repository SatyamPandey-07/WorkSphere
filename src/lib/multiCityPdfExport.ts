import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { drawSafeText, safeText } from "@/lib/pdfHelpers";
import { Venue } from "@/components/chat/ChatMessages";

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
      : null;

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

  // Use A4 Landscape [842, 595] for side-by-side multi-city column layout
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let page = pdfDoc.addPage([842, 595]);
  const { width, height } = page.getSize();
  const margin = 40;
  let y = height - margin;

  const newPage = () => {
    page = pdfDoc.addPage([842, 595]);
    y = height - margin;
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < margin) newPage();
  };

  // Top Accent Bar (Blue)
  page.drawRectangle({
    x: 0,
    y: height - 6,
    width,
    height: 6,
    color: rgb(0.15, 0.45, 0.95),
  });

  // Title Header
  drawSafeText(page, "WorkSphere Multi-City Nomad Workspace Report", {
    x: margin,
    y,
    size: 18,
    font: bold,
    color: rgb(0.08, 0.12, 0.2),
  });
  y -= 20;

  drawSafeText(
    page,
    "Side-by-side comparison of Wi-Fi speeds, noise levels, and power outlet density metrics across global nomad hubs.",
    {
      x: margin,
      y,
      size: 9.5,
      font,
      color: rgb(0.35, 0.4, 0.45),
    },
  );
  y -= 16;

  const formattedDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  drawSafeText(
    page,
    `Generated: ${formattedDate}  ·  Cities Compared: ${selectedCities.length}  ·  Total Venues: ${venues.length}`,
    {
      x: margin,
      y,
      size: 8.5,
      font,
      color: rgb(0.45, 0.5, 0.55),
    },
  );
  y -= 20;

  // Header Divider
  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 1,
    color: rgb(0.85, 0.88, 0.92),
  });
  y -= 20;

  const citySummaries = selectedCities.map((city) =>
    computeCityMetrics(city, venues),
  );

  if (citySummaries.length === 0) {
    drawSafeText(page, "No cities selected for comparison.", {
      x: margin,
      y,
      size: 11,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
    return pdfDoc.save();
  }

  // Calculate side-by-side column layout dimensions
  const availableWidth = width - margin * 2;
  const colGap = 16;
  const numCols = Math.min(citySummaries.length, 3);
  const colWidth = (availableWidth - colGap * (numCols - 1)) / numCols;

  // Render City Summary Cards
  ensureSpace(120);
  const summaryBoxY = y - 110;

  citySummaries.slice(0, numCols).forEach((summary, idx) => {
    const colX = margin + idx * (colWidth + colGap);

    // City Column Card Box
    page.drawRectangle({
      x: colX,
      y: summaryBoxY,
      width: colWidth,
      height: 110,
      color: rgb(0.96, 0.97, 0.99),
      borderColor: rgb(0.82, 0.86, 0.92),
      borderWidth: 1,
    });

    // Header Tag
    drawSafeText(page, safeText(summary.city).toUpperCase(), {
      x: colX + 12,
      y: summaryBoxY + 88,
      size: 11,
      font: bold,
      color: rgb(0.12, 0.25, 0.65),
    });

    // Metrics List
    drawSafeText(page, `• Total Workspaces: ${summary.totalVenues}`, {
      x: colX + 12,
      y: summaryBoxY + 68,
      size: 9,
      font,
      color: rgb(0.2, 0.2, 0.2),
    });

    const wifiText = summary.avgWifiSpeed
      ? `${summary.avgWifiSpeed} Mbps avg`
      : "N/A";
    drawSafeText(page, `• Wi-Fi Speed: ${wifiText}`, {
      x: colX + 12,
      y: summaryBoxY + 52,
      size: 9,
      font,
      color: rgb(0.1, 0.55, 0.35),
    });

    drawSafeText(page, `• Noise Level: ${summary.quietRatio}% Quiet`, {
      x: colX + 12,
      y: summaryBoxY + 36,
      size: 9,
      font,
      color: rgb(0.2, 0.45, 0.8),
    });

    drawSafeText(page, `• Power Outlets: ${summary.outletRatio}% Density`, {
      x: colX + 12,
      y: summaryBoxY + 20,
      size: 9,
      font,
      color: rgb(0.85, 0.45, 0.05),
    });
  });

  y = summaryBoxY - 24;

  // Render Detailed Venue Lists Side-by-Side per City Column
  ensureSpace(40);
  drawSafeText(page, "DETAILED VENUE COMPARISON MATRIX", {
    x: margin,
    y,
    size: 11,
    font: bold,
    color: rgb(0.2, 0.25, 0.3),
  });
  y -= 16;

  // Maximum items to list per column on page
  const maxVenuesPerCol = Math.max(
    ...citySummaries.map((s) => s.venues.length),
    0,
  );

  if (maxVenuesPerCol === 0) {
    drawSafeText(page, "No venue details recorded for the selected cities.", {
      x: margin,
      y,
      size: 9.5,
      font,
      color: rgb(0.5, 0.5, 0.5),
    });
  } else {
    for (let vIdx = 0; vIdx < Math.min(maxVenuesPerCol, 8); vIdx++) {
      ensureSpace(44);
      const rowY = y - 36;

      citySummaries.slice(0, numCols).forEach((summary, cIdx) => {
        const colX = margin + cIdx * (colWidth + colGap);
        const venue = summary.venues[vIdx];

        if (venue) {
          page.drawRectangle({
            x: colX,
            y: rowY,
            width: colWidth,
            height: 36,
            color: rgb(1, 1, 1),
            borderColor: rgb(0.88, 0.9, 0.94),
            borderWidth: 0.75,
          });

          // Venue Name
          drawSafeText(page, safeText(venue.name).slice(0, 32), {
            x: colX + 8,
            y: rowY + 22,
            size: 8.5,
            font: bold,
            color: rgb(0.1, 0.1, 0.15),
          });

          // Metrics Line: WiFi, Noise, Outlets
          const wifiStr = venue.wifiSpeed ? `${venue.wifiSpeed}M` : "WiFi";
          const noiseStr = venue.noiseLevel || "Normal";
          const outletStr = venue.hasOutlets ? "Power Yes" : "Power No";
          const metricsLine = `${wifiStr} · ${noiseStr} · ${outletStr}`;

          drawSafeText(page, safeText(metricsLine), {
            x: colX + 8,
            y: rowY + 8,
            size: 7.5,
            font,
            color: rgb(0.4, 0.45, 0.5),
          });
        }
      });

      y -= 42;
    }
  }

  // Footer Page Number & Branding
  const pages = pdfDoc.getPages();
  pages.forEach((p, pIdx) => {
    p.drawRectangle({
      x: 0,
      y: 0,
      width: 842,
      height: 24,
      color: rgb(0.96, 0.97, 0.98),
    });

    drawSafeText(
      p,
      `WorkSphere Nomad Telemetry  ·  Page ${pIdx + 1} of ${pages.length}`,
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
