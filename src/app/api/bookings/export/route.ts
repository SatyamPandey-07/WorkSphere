import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function escapeCsvField(field: any): string {
  if (field === null || field === undefined) return '""';
  const stringified = String(field);
  if (/[",\n\r]/.test(stringified)) {
    return `"${stringified.replace(/"/g, '""')}"`;
  }
  return `"${stringified}"`;
}

export async function GET(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const format = (searchParams.get("format") || "json").toLowerCase();
    const statusParam = searchParams.get("status");

    const whereClause: any = { userId };
    if (statusParam) {
      whereClause.status = statusParam;
    }

    const bookings = await prisma.booking.findMany({
      where: whereClause,
      include: {
        venue: {
          select: {
            name: true,
            address: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const timestamp = Date.now();

    if (format === "csv") {
      const headers = [
        "Booking ID",
        "Venue Name",
        "Address",
        "Date",
        "Time",
        "Duration (Min)",
        "Status",
        "Price",
        "Currency",
      ];

      const rows = bookings.map((b: any) => {
        const bookingDate = new Date(b.bookingDate || b.createdAt || Date.now());
        const dateStr = bookingDate.toISOString().split("T")[0];
        const timeStr = bookingDate.toISOString().split("T")[1]?.slice(0, 5) || "00:00";

        return [
          escapeCsvField(b.id),
          escapeCsvField(b.venue?.name || "N/A"),
          escapeCsvField(b.venue?.address || "N/A"),
          escapeCsvField(dateStr),
          escapeCsvField(timeStr),
          escapeCsvField(b.durationMinutes || b.duration || 60),
          escapeCsvField(b.status),
          escapeCsvField(b.price || b.totalAmount || 0),
          escapeCsvField(b.currency || "USD"),
        ].join(",");
      });

      const csvContent = [headers.join(","), ...rows].join("\n");

      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="worksphere-bookings-${timestamp}.csv"`,
        },
      });
    }

    // Default: JSON response
    const formattedBookings = bookings.map((b: any) => ({
      id: b.id,
      venueName: b.venue?.name || "N/A",
      address: b.venue?.address || "N/A",
      bookingDate: new Date(b.bookingDate || b.createdAt).toISOString(),
      durationMinutes: b.durationMinutes || b.duration || 60,
      status: b.status,
      price: b.price || b.totalAmount || 0,
      currency: b.currency || "USD",
      createdAt: new Date(b.createdAt).toISOString(),
    }));

    return new NextResponse(JSON.stringify({ bookings: formattedBookings }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="worksphere-bookings-${timestamp}.json"`,
      },
    });
  } catch (error: any) {
    console.error("Booking export error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}