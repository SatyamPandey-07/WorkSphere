import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { ensureUserExists } from "@/lib/auth";
import { bookingsToCSV } from "@/lib/pdfHelpers";
import { resolveDateRange, filterBookingsByRange } from "@/lib/taxExport";
import { pushJob } from "@/lib/queue";

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureUserExists(userId);

    const body = await req.json();
    const { bookingIds, format, taxYear, startDate, endDate } = body;

    if (format !== "pdf" && format !== "csv") {
      return NextResponse.json({ error: "Invalid format" }, { status: 400 });
    }

    const usingDateRange = !bookingIds && (taxYear || (startDate && endDate));

    if (!Array.isArray(bookingIds) && !usingDateRange) {
      return NextResponse.json(
        { error: "Provide either bookingIds or a taxYear/date range" },
        { status: 400 },
      );
    }

    let bookings;

    if (Array.isArray(bookingIds) && bookingIds.length > 0) {
      // Only fetch bookings that belong to this user - never trust client-supplied ownership
      bookings = await (prisma as any).booking.findMany({
        where: { id: { in: bookingIds }, userId },
        include: { venue: true, user: true },
        orderBy: { createdAt: "desc" },
      });
    } else {
      // Date-range / tax-year path (issue #198)
      let range;
      try {
        range = resolveDateRange({ taxYear, startDate, endDate });
      } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }

      const allUserBookings = await (prisma as any).booking.findMany({
        where: { userId },
        include: { venue: true, user: true },
        orderBy: { createdAt: "desc" },
      });

      bookings = filterBookingsByRange(allUserBookings, range);
    }

    if (bookings.length === 0) {
      return NextResponse.json(
        { error: "No matching bookings found" },
        { status: 404 },
      );
    }

    if (format === "csv") {
      const csv =
        "Estimate only - $15/hr flat rate, 8% flat tax - verify against your invoices\n" +
        bookingsToCSV(bookings);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="WorkSphere_Tax_Export_${Date.now()}.csv"`,
          "Cache-Control": "no-cache",
        },
      });
    }

    // PDF path
    const jobId = crypto.randomUUID();
    
    // Instead of passing all booking objects which could be large and cause Redis to choke,
    // we just pass the criteria. The worker can fetch them again. Or we can just pass the bookings.
    // Given the payload might be up to a few MBs, let's just pass the same criteria so the worker
    // fetches them.
    await pushJob(jobId, {
      userId,
      type: "TAX_EXPORT",
      data: {
        bookingIds,
        taxYear,
        startDate,
        endDate
      }
    });

    return NextResponse.json({ jobId, status: "QUEUED" }, { status: 202 });
  } catch (error: any) {
    console.error("[Bookings Export Error]:", error);
    return NextResponse.json(
      { error: "Failed to generate export" },
      { status: 500 },
    );
  }
}