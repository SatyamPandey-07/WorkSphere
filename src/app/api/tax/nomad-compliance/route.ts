/**
 * route.ts
 * /api/tax/nomad-compliance
 * Calculates digital nomad visa stay metrics, Schengen 90/180 rolling quotas,
 * multi-jurisdiction physical presence collision resolution, and exports deductible expense dossiers.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  generateNomadComplianceReport,
  exportComplianceReportCSV,
  calculateNomadTaxPresence,
  generateNomadTaxAuditPdf,
  type NomadCheckInRecord,
  type TaxPresenceEntry,
  type NomadTaxOptions,
} from "@/lib/tax/nomadTaxEngine";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId") || "user_nomad_demo";
    const year = Number(searchParams.get("year")) || new Date().getFullYear();

    // Fetch user's bookings and check-ins
    const bookings = await prisma.booking.findMany({
      where: { userId },
      include: {
        venue: {
          select: {
            id: true,
            name: true,
            address: true,
            category: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    // Parse records or generate realistic nomad itinerary entries if new user
    let records: NomadCheckInRecord[] = bookings.map((b) => {
      const address = b.venue?.address || "Berlin, Germany";
      const isSpain =
        address.includes("Spain") ||
        address.includes("Barcelona") ||
        address.includes("Madrid");
      const isPortugal =
        address.includes("Portugal") ||
        address.includes("Lisbon") ||
        address.includes("Porto");
      const isGermany =
        address.includes("Germany") || address.includes("Berlin");
      const isJapan = address.includes("Japan") || address.includes("Tokyo");
      const isUK = address.includes("UK") || address.includes("London");

      let country = "Germany";
      let countryCode = "DE";
      let city = "Berlin";
      let isSchengen = true;
      let vatRate = 19;

      if (isSpain) {
        country = "Spain";
        countryCode = "ES";
        city = "Barcelona";
        vatRate = 21;
      } else if (isPortugal) {
        country = "Portugal";
        countryCode = "PT";
        city = "Lisbon";
        vatRate = 23;
      } else if (isJapan) {
        country = "Japan";
        countryCode = "JP";
        city = "Tokyo";
        isSchengen = false;
        vatRate = 10;
      } else if (isUK) {
        country = "United Kingdom";
        countryCode = "GB";
        city = "London";
        isSchengen = false;
        vatRate = 20;
      }

      return {
        id: b.id,
        venueId: b.venueId,
        venueName: b.venue.name,
        city,
        country,
        countryCode,
        isSchengen,
        date: b.date || new Date(b.createdAt).toISOString().split("T")[0],
        amountSpent: 28.5,
        currency: "USD",
        vatRatePct: vatRate,
      };
    });

    // If mock records needed for demonstration when user has few DB bookings
    if (records.length < 5) {
      const today = new Date();
      records = [
        {
          id: "rec-1",
          venueId: "v-lisbon",
          venueName: "Second Home Coworking",
          city: "Lisbon",
          country: "Portugal",
          countryCode: "PT",
          isSchengen: true,
          date: new Date(today.getTime() - 25 * 86400000)
            .toISOString()
            .split("T")[0],
          amountSpent: 220,
          currency: "USD",
          vatRatePct: 23,
        },
        {
          id: "rec-2",
          venueId: "v-bcn",
          venueName: "Betahaus Barcelona",
          city: "Barcelona",
          country: "Spain",
          countryCode: "ES",
          isSchengen: true,
          date: new Date(today.getTime() - 12 * 86400000)
            .toISOString()
            .split("T")[0],
          amountSpent: 310,
          currency: "USD",
          vatRatePct: 21,
        },
        {
          id: "rec-3",
          venueId: "v-berlin",
          venueName: "Factory Berlin Mitte",
          city: "Berlin",
          country: "Germany",
          countryCode: "DE",
          isSchengen: true,
          date: new Date(today.getTime() - 2 * 86400000)
            .toISOString()
            .split("T")[0],
          amountSpent: 180,
          currency: "USD",
          vatRatePct: 19,
        },
        {
          id: "rec-4",
          venueId: "v-tokyo",
          venueName: "WeWork Shibuya Scramble",
          city: "Tokyo",
          country: "Japan",
          countryCode: "JP",
          isSchengen: false,
          date: new Date(today.getTime() - 75 * 86400000)
            .toISOString()
            .split("T")[0],
          amountSpent: 450,
          currency: "USD",
          vatRatePct: 10,
        },
      ];
    }

    const report = generateNomadComplianceReport(records, year);

    if (searchParams.get("format") === "pdf") {
      const pdfBytes = await generateNomadTaxAuditPdf(report, { userId });
      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename=WorkSphere-Nomad-Tax-Audit-${report.taxYear}.pdf`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      report,
      recordsCount: records.length,
    });
  } catch (error: any) {
    console.error("[GET /api/tax/nomad-compliance] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate compliance report", details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    // Path A: Physical presence collision calculation endpoint if entries array provided
    if (Array.isArray(body.entries)) {
      const entries: TaxPresenceEntry[] = body.entries;
      const options: NomadTaxOptions = {
        taxYear: body.taxYear ? Number(body.taxYear) : undefined,
        taxResidencyThresholdDays: body.taxResidencyThresholdDays
          ? Number(body.taxResidencyThresholdDays)
          : 183,
        collisionRule: body.collisionRule || "DESTINATION_PRIORITY",
      };

      if (entries.length === 0) {
        return NextResponse.json(
          {
            error: "Invalid request payload. Expected an array of 'entries'.",
          },
          { status: 400 }
        );
      }

      const report = calculateNomadTaxPresence(entries, options);
      return NextResponse.json({
        success: true,
        report,
      });
    }

    // Path B: Report CSV Export or Dossier export
    const { report, format = "csv" } = body;

    if (!report) {
      return NextResponse.json(
        { error: "Missing report or entries data" },
        { status: 400 }
      );
    }

    if (format === "csv") {
      const csvData = exportComplianceReportCSV(report);
      return new NextResponse(csvData, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename=WorkSphere-Nomad-Tax-Dossier-${report.taxYear}.csv`,
        },
      });
    }

    if (format === "pdf") {
      const pdfBytes = await generateNomadTaxAuditPdf(report, {
        userId: body.userId,
        userName: body.userName,
        taxId: body.taxId,
      });
      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename=WorkSphere-Nomad-Tax-Audit-${report.taxYear}.pdf`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      dossier: {
        summary: report,
        exportFormat: format,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error("[POST /api/tax/nomad-compliance] Error:", error);
    return NextResponse.json(
      { error: "Failed to process compliance report", details: error.message },
      { status: 500 }
    );
  }
}
