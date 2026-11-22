import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

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
        const bookingDate = new Date(
          b.bookingDate || b.createdAt || Date.now(),
        );
        const dateStr = bookingDate.toISOString().split("T")[0];
        const timeStr =
          bookingDate.toISOString().split("T")[1]?.slice(0, 5) || "00:00";

        return [
          escapeCsvField(b.id),
          escapeCsvField(b.venue?.name || "N/A"),
          escapeCsvField(b.venue?.address || "N/A"),
          escapeCsvField(dateStr),
          escapeCsvField(timeStr),
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
