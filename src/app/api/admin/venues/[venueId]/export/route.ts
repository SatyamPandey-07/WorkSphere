import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { getAdminUser } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import {
  fetchVenueAuditRows,
  createVenueAuditCsvStream,
  generateVenueAuditPDF,
} from "@/lib/export/auditExporter";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ venueId: string }> | { venueId: string };
};

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { venueId } = await Promise.resolve(context.params);

    if (!venueId) {
      return NextResponse.json(
        { error: "Venue ID is required" },
        { status: 400 },
      );
    }

    // 1. Authentication check
    const user = await currentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Fetch venue details
    const venue = await prisma.venue.findFirst({
      where: { OR: [{ id: venueId }, { placeId: venueId }] },
      select: { id: true, name: true, ownerId: true, creatorId: true },
    });

    if (!venue) {
      return NextResponse.json({ error: "Venue not found" }, { status: 404 });
    }

    // 3. Authorization check: strictly ADMIN or VENUE_OWNER roles
    const adminUser = await getAdminUser();
    const publicRole =
      typeof user.publicMetadata?.role === "string"
        ? user.publicMetadata.role.toLowerCase()
        : "";
    const privateRole =
      typeof user.privateMetadata?.role === "string"
        ? user.privateMetadata.role.toLowerCase()
        : "";
    const role = privateRole || publicRole;

    const isAdmin =
      Boolean(adminUser) ||
      ["admin", "super_admin", "superadmin"].includes(role);

    const isVenueOwnerRole =
      role === "venue_owner" || role === "owner" || role === "venue-owner";
    const isVenueCreatorOrOwner =
      venue.ownerId === user.id || venue.creatorId === user.id;

    if (!isAdmin && !isVenueOwnerRole && !isVenueCreatorOrOwner) {
      return NextResponse.json(
        { error: "Forbidden: Restricted to ADMIN or VENUE_OWNER roles" },
        { status: 403 },
      );
    }

    // Cross-tenant guard: venue owners cannot export reports for venues they do not own
    if (
      !isAdmin &&
      venue.ownerId &&
      venue.ownerId !== user.id &&
      venue.creatorId !== user.id
    ) {
      return NextResponse.json(
        { error: "Forbidden: Not authorized for this venue" },
        { status: 403 },
      );
    }

    // 4. Query parameters
    const { searchParams } = new URL(request.url);
    const format = (searchParams.get("format") || "csv").toLowerCase();
    const month = searchParams.get("month") || undefined;
    const startDateParam = searchParams.get("startDate") || undefined;
    const endDateParam = searchParams.get("endDate") || undefined;

    if (format !== "csv" && format !== "pdf") {
      return NextResponse.json(
        {
          error:
            "Invalid format parameter. Supported formats are 'csv' and 'pdf'.",
        },
        { status: 400 },
      );
    }

    // Date range validation
    let startDate: string | undefined = undefined;
    let endDate: string | undefined = undefined;

    if (startDateParam || endDateParam) {
      if (!startDateParam || !endDateParam) {
        return NextResponse.json(
          { error: "Both startDate and endDate must be provided when filtering by date range" },
          { status: 400 },
        );
      }

      const parsedStart = new Date(startDateParam);
      const parsedEnd = new Date(endDateParam);

      if (isNaN(parsedStart.getTime())) {
        return NextResponse.json(
          { error: "Invalid startDate parameter. Must be a valid ISO date string." },
          { status: 400 },
        );
      }

      if (isNaN(parsedEnd.getTime())) {
        return NextResponse.json(
          { error: "Invalid endDate parameter. Must be a valid ISO date string." },
          { status: 400 },
        );
      }

      if (parsedStart.getTime() >= parsedEnd.getTime()) {
        return NextResponse.json(
          { error: "startDate must be strictly before endDate" },
          { status: 400 },
        );
      }

      const diffMs = parsedEnd.getTime() - parsedStart.getTime();
      const maxMs = 90 * 24 * 60 * 60 * 1000;
      if (diffMs > maxMs) {
        return NextResponse.json(
          { error: "Date range cannot exceed 90 days" },
          { status: 400 },
        );
      }

      startDate = parsedStart.toISOString();
      endDate = parsedEnd.toISOString();
    }

    // 5. Fetch audit data
    const rows = await fetchVenueAuditRows(venue.id, {
      month,
      startDate,
      endDate,
    });

    const sanitizedId = venue.id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const dateSlug = month || new Date().toISOString().slice(0, 10);

    // 6. Handle CSV streaming export
    if (format === "csv") {
      const filename = `venue-${sanitizedId}-audit-${dateSlug}.csv`;
      const stream = createVenueAuditCsvStream(rows);

      return new NextResponse(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "private, no-store, max-age=0",
        },
      });
    }

    // 7. Handle PDF export
    const pdfBytes = await generateVenueAuditPDF(rows, {
      venueName: venue.name,
      venueId: venue.id,
      month,
    });
    const filename = `venue-${sanitizedId}-audit-${dateSlug}.pdf`;

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("[Admin Venue Export]", error);
    return NextResponse.json(
      { error: "Failed to export venue audit report" },
      { status: 500 },
    );
  }
}
