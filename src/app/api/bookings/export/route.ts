import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { parseBookingDateTime } from "@/lib/booking/dateTimeAdapter";

/**
 * Escapes a CSV cell in accordance with RFC 4180 while mitigating
 * spreadsheet formula injection (CWE-1236).
 *
 * Dangerous formula triggers:
 * - Begins with =, +, -, @, |, %
 * - Begins with control characters (tab, CR, LF, etc.) or whitespace followed by formula triggers
 *
 * Rules:
 * - Legitimate numeric values (including negative numbers and numeric strings) are preserved without apostrophe prefixes.
 * - Untrusted text values that match formula triggers are prefixed with a single quote (').
 * - Double quotes, commas, CRLF, and newlines are safely quoted in accordance with RFC 4180.
 */
function resolveBookingSchedule(b: any): {
  date: string;
  time: string;
  timeZone: string;
  bookingDate: string;
} {
  const timeZone = b.timeZone || "UTC";

  // Use the authoritative reservation schedule stored in Prisma (date, time, timeZone)
  if (b.date && b.time) {
    const scheduledInstant = parseBookingDateTime(b.date, b.time, timeZone);
    const dateStr = b.date;
    const timeStr = b.time;
    const isoDate = scheduledInstant
      ? scheduledInstant.toISOString()
      : new Date(`${b.date}T${b.time}Z`).toISOString();

    return {
      date: dateStr,
      time: timeStr,
      timeZone,
      bookingDate: isoDate,
    };
  }

  // Fallback for legacy or incomplete records
  const fallbackDate = new Date(b.bookingDate || b.createdAt || Date.now());
  const dateStr = !isNaN(fallbackDate.getTime())
    ? fallbackDate.toISOString().split("T")[0]
    : "";
  const timeStr = !isNaN(fallbackDate.getTime())
    ? fallbackDate.toISOString().split("T")[1]?.slice(0, 5) || "00:00"
    : "00:00";
  const isoDate = !isNaN(fallbackDate.getTime())
    ? fallbackDate.toISOString()
    : new Date().toISOString();

  return {
    date: dateStr,
    time: timeStr,
    timeZone,
    bookingDate: isoDate,
  };
}

export function escapeCsvField(field: any, isNumeric = false): string {
  if (field === null || field === undefined) {
    return "";
  }

  // Handle finite JavaScript numbers directly
  if (typeof field === "number") {
    if (!Number.isFinite(field)) return "";
    return String(field);
  }

  // Handle boolean values
  if (typeof field === "boolean") {
    return String(field);
  }

  const rawStr = String(field).replace(/\0/g, "");

  // If explicitly flagged as numeric or matches a pure signed decimal/integer number
  if (isNumeric || /^-?\d+(\.\d+)?$/.test(rawStr.trim())) {
    if (/^-?\d+(\.\d+)?$/.test(rawStr.trim())) {
      return rawStr.trim();
    }
  }

  let sanitized = rawStr;

  // Check if string starts with dangerous formula prefixes,
  // or leading whitespace / control characters followed by formula prefixes.
  const startsWithDangerousChar = /^[=+\-@|%\t\r\n]/.test(sanitized);
  const leadingWsFormula = /^[\s\x00-\x1f]+[=+\-@|%]/.test(sanitized);

  if (startsWithDangerousChar || leadingWsFormula) {
    if (!sanitized.startsWith("'")) {
      sanitized = "'" + sanitized;
    }
  }

  // RFC 4180 escaping: quote if field contains quote, comma, or newline
  if (
    sanitized.includes('"') ||
    sanitized.includes(",") ||
    sanitized.includes("\n") ||
    sanitized.includes("\r")
  ) {
    return `"${sanitized.replace(/"/g, '""')}"`;
  }

  return sanitized;
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
        const schedule = resolveBookingSchedule(b);

        return [
          escapeCsvField(b.id),
          escapeCsvField(b.venue?.name || "N/A"),
          escapeCsvField(b.venue?.address || "N/A"),
          escapeCsvField(schedule.date),
          escapeCsvField(schedule.time),
          escapeCsvField(b.durationMinutes ?? b.duration ?? 60, true),
          escapeCsvField(b.status),
          escapeCsvField(b.price ?? b.totalAmount ?? 0, true),
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
    const formattedBookings = bookings.map((b: any) => {
      const schedule = resolveBookingSchedule(b);

      return {
        id: b.id,
        venueName: b.venue?.name || "N/A",
        address: b.venue?.address || "N/A",
        date: schedule.date,
        time: schedule.time,
        timeZone: schedule.timeZone,
        bookingDate: schedule.bookingDate,
        durationMinutes: b.durationMinutes || b.duration || 60,
        status: b.status,
        price: b.price || b.totalAmount || 0,
        currency: b.currency || "USD",
        createdAt: new Date(b.createdAt).toISOString(),
      };
    });

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
