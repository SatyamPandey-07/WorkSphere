import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import {
  getAdminSystemMetrics,
  parseSystemRange,
} from "@/lib/adminSystemMetrics";
import { generateSystemVitalsCSV } from "@/lib/export/domain/systemVitalsExporter";
import {
  fetchWeeklyVenueAnalyticsData,
  generateWeeklyVenueAnalyticsCSV,
  processWeeklyVenueAnalyticsJob,
} from "@/lib/export/domain/weeklyVenueAnalyticsExporter";
import { generateDefaultWebVitalsData } from "@/lib/webVitalsCollector";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const exportType = searchParams.get("type") || searchParams.get("action");

    // Handle weekly venue analytics CSV export query
    if (exportType === "weekly" || exportType === "weekly-venue-analytics") {
      const admin = await getAdminUser();
      const authHeader = request.headers.get("authorization");
      const isCronSecretValid =
        process.env.CRON_SECRET &&
        authHeader === `Bearer ${process.env.CRON_SECRET}`;

      if (!admin && !isCronSecretValid) {
        return NextResponse.json(
          { error: "Admin access or valid cron authorization required" },
          { status: 403 },
        );
      }

      const venueId = searchParams.get("venueId") || undefined;
      const data = await fetchWeeklyVenueAnalyticsData({ venueId });
      const csvContent = generateWeeklyVenueAnalyticsCSV(data);
      const filename = `worksphere-weekly-venue-analytics-${data.startDate}-to-${data.endDate}.csv`;

      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "private, no-store, max-age=0",
        },
      });
    }

    // Default: System Vitals CSV Export
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      );
    }

    const range = parseSystemRange(searchParams.get("range"));

    const [metrics, webVitals] = await Promise.all([
      getAdminSystemMetrics(range),
      Promise.resolve(generateDefaultWebVitalsData(range)),
    ]);

    const exportData = {
      ...metrics,
      webVitals,
    };

    const csvContent = generateSystemVitalsCSV(exportData);
    const today = new Date().toISOString().slice(0, 10);
    const filename = `worksphere-system-vitals-${range}-${today}.csv`;

    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("[Admin System CSV Export API GET]", error);
    return NextResponse.json(
      { error: "Failed to export system vital metrics" },
      { status: 500 },
    );
  }
}

/**
 * POST /api/admin/system/export
 *
 * Automated weekly background job trigger for venue analytics CSV report generation
 * and Nodemailer email dispatch to venue managers.
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    const isCronSecretValid =
      process.env.CRON_SECRET &&
      authHeader === `Bearer ${process.env.CRON_SECRET}`;

    const admin = await getAdminUser();

    if (!admin && !isCronSecretValid) {
      return NextResponse.json(
        { error: "Unauthorized background job invocation" },
        { status: 403 },
      );
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      // Empty body fallback
    }

    const recipientEmail = body?.recipientEmail || body?.email || undefined;
    const venueId = body?.venueId || undefined;

    const result = await processWeeklyVenueAnalyticsJob({
      recipientEmail,
      ...(venueId ? { venueId } : {}),
    });

    return NextResponse.json({
      success: true,
      message: "Weekly venue analytics CSV report generated and queued for dispatch",
      totalVenues: result.totalVenues,
      emailSent: result.emailSent,
      recipient: result.recipient,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("[Admin System Export POST Cron Job Error]", error);
    return NextResponse.json(
      {
        error: "Failed to execute automated weekly venue analytics export job",
        details: error?.message || "Unknown error",
      },
      { status: 500 },
    );
  }
}
