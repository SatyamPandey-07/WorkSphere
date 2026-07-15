import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { hasFolderAccess } from "@/lib/folders";

// GET /api/folders/[id]/export-billing - Export billing CSV
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { id } = await params;
    const { folder, hasAccess } = await hasFolderAccess(id, userId);

    if (!folder) {
      return new NextResponse("Folder not found", { status: 404 });
    }
    if (!hasAccess) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    // 1. Fetch all venues in the folder
    const folderVenues = await prisma.folderVenue.findMany({
      where: { folderId: id },
      select: { venueId: true },
    });

    const venueIds = folderVenues.map((fv) => fv.venueId);

    // 2. Fetch all confirmed bookings for these venues
    const bookings = await prisma.booking.findMany({
      where: {
        venueId: { in: venueIds },
        status: "CONFIRMED",
      },
      include: {
        venue: {
          select: { name: true },
        },
        user: {
          select: { firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { date: "desc" },
    });

    // 3. Generate CSV content
    // CSV Header
    const headers = [
      "Date",
      "Venue Name",
      "User Name",
      "User Email",
      "Duration (mins)",
      "Billing Code",
      "Confirmation ID",
      "Mock Expense ($)",
    ];

    const rows = bookings.map((booking) => {
      const userName =
        `${booking.user.firstName || ""} ${booking.user.lastName || ""}`.trim() ||
        "Anonymous";
      const duration = booking.duration || 60; // Default to 60 if not specified

      // Heuristic for mock expense: $15 base + $0.25 per minute
      const mockExpense = (15 + duration * 0.25).toFixed(2);

      return [
        booking.date,
        `"${booking.venue.name.replace(/"/g, '""')}"`,
        `"${userName.replace(/"/g, '""')}"`,
        booking.user.email || booking.customerEmail,
        duration,
        booking.projectBillingCode || "N/A",
        booking.confirmationId,
        mockExpense,
      ];
    });

    const csvContent = [
      headers.join(","),
      ...rows.map((row) => row.join(",")),
    ].join("\n");

    // 4. Return as dynamic CSV stream/file
    const filename = `billing-export-${folder.name.toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.csv`;

    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    console.error(`GET /api/folders/id/export-billing error:`, error);
    return new NextResponse("Failed to generate export", { status: 500 });
  }
}
