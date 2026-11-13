import { auth } from "@clerk/nextjs/server";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const CSV_HEADERS = [
  "CheckInId",
  "VenueName",
  "City",
  "CountryCode",
  "ArrivalTimestampUtc",
  "DepartureTimestampUtc",
  "DurationHours",
  "VerificationProofType",
] as const;

interface PresenceExportRow {
  CheckInId: string;
  VenueName: string;
  City: string;
  CountryCode: string;
  ArrivalTimestampUtc: string;
  DepartureTimestampUtc: string;
  DurationHours: number;
  VerificationProofType: string;
}

function locationFromAddress(address: string | null): {
  city: string;
  countryCode: string;
} {
  const value = address ?? "";
  const lowerValue = value.toLowerCase();
  const locations = [
    { terms: ["barcelona", "spain"], city: "Barcelona", countryCode: "ES" },
    { terms: ["madrid", "spain"], city: "Madrid", countryCode: "ES" },
    { terms: ["lisbon", "portugal"], city: "Lisbon", countryCode: "PT" },
    { terms: ["porto", "portugal"], city: "Porto", countryCode: "PT" },
    { terms: ["tokyo", "japan"], city: "Tokyo", countryCode: "JP" },
    {
      terms: ["london", "uk", "united kingdom"],
      city: "London",
      countryCode: "GB",
    },
    { terms: ["berlin", "germany"], city: "Berlin", countryCode: "DE" },
  ];

  const match = locations.find(({ terms }) =>
    terms.some((term) => lowerValue.includes(term)),
  );
  if (match) {
    return { city: match.city, countryCode: match.countryCode };
  }

  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return {
    city: parts[0] || "Unknown",
    countryCode: "UN",
  };
}

function escapeCsvField(value: string | number): string {
  const text = String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function toCsvRow(row: PresenceExportRow): string {
  return [
    row.CheckInId,
    row.VenueName,
    row.City,
    row.CountryCode,
    row.ArrivalTimestampUtc,
    row.DepartureTimestampUtc,
    row.DurationHours,
    row.VerificationProofType,
  ]
    .map(escapeCsvField)
    .join(",");
}

export async function GET(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const yearParam = request.nextUrl.searchParams.get("year");
  const formatParam = request.nextUrl.searchParams.get("format") ?? "csv";
  const year = yearParam
    ? Number(yearParam)
    : new Date().getUTCFullYear();

  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    return NextResponse.json({ error: "Invalid year parameter" }, { status: 400 });
  }
  if (formatParam !== "csv" && formatParam !== "json") {
    return NextResponse.json(
      { error: 'Invalid format. Expected "csv" or "json".' },
      { status: 400 },
    );
  }

  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const startOfNextYear = new Date(Date.UTC(year + 1, 0, 1));
  const checkIns = await prisma.checkIn.findMany({
    where: {
      userId,
      createdAt: {
        gte: startOfYear,
        lt: startOfNextYear,
      },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      venue: {
        select: {
          name: true,
          address: true,
        },
      },
    },
  });

  const rows: PresenceExportRow[] = checkIns.map((checkIn) => {
    const arrivalMs = checkIn.createdAt.getTime();
    const departureMs = checkIn.expiresAt.getTime();
    const { city, countryCode } = locationFromAddress(checkIn.venue.address);

    return {
      CheckInId: checkIn.id,
      VenueName: checkIn.venue.name,
      City: city,
      CountryCode: countryCode,
      ArrivalTimestampUtc: checkIn.createdAt.toISOString(),
      DepartureTimestampUtc: checkIn.expiresAt.toISOString(),
      DurationHours:
        Math.round((Math.max(0, departureMs - arrivalMs) / 3_600_000) * 100) /
        100,
      VerificationProofType: "CHECK_IN",
    };
  });

  if (formatParam === "json") {
    return NextResponse.json(rows);
  }

  const encoder = new TextEncoder();
  const csvStream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${CSV_HEADERS.join(",")}\r\n`));
      for (const row of rows) {
        controller.enqueue(encoder.encode(`${toCsvRow(row)}\r\n`));
      }
      controller.close();
    },
  });

  return new NextResponse(csvStream, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tax-presence-${year}.csv"`,
    },
  });
}
