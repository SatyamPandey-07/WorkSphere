import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAdminUser } from "@/lib/admin";

/**
 * Development-only fixture loader for the booking-density heatmap.
 *
 * Writes demo venues, users, bookings and ratings, so it must never be
 * reachable in production and only an admin may trigger it locally.
 */
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const todayStr = new Date().toISOString().split("T")[0];

    const venue = await prisma.venue.upsert({
      where: { placeId: "demo-heatmap-1" },
      update: {},
      create: {
        name: "Demo Heatmap Hub",
        placeId: "demo-heatmap-1",
        latitude: 20.266,
        longitude: 73.016,
        category: "coworking",
        address: "Silvassa Center, DNH",
        rating: 4.8,
      },
    });

    const demoUsers = [
      { id: "demo_heatmap_user_1", email: "heatmap-1@demo.worksphere.local" },
      { id: "demo_heatmap_user_2", email: "heatmap-2@demo.worksphere.local" },
    ];
    for (const u of demoUsers) {
      await prisma.user.upsert({
        where: { id: u.id },
        update: {},
        create: { id: u.id, email: u.email, firstName: "Demo" },
      });
    }

    await prisma.booking.createMany({
      data: demoUsers.map((u, i) => ({
        userId: u.id,
        venueId: venue.id,
        date: todayStr,
        time: i === 0 ? "10:00" : "11:30",
        customerEmail: u.email,
        confirmationId: `DEMO-${todayStr}-${i}`,
        status: "CONFIRMED" as const,
      })),
      skipDuplicates: true,
    });

    await prisma.venueRating.upsert({
      where: {
        userId_venueId: { userId: demoUsers[0].id, venueId: venue.id },
      },
      update: { noiseLevel: "loud" },
      create: {
        userId: demoUsers[0].id,
        venueId: venue.id,
        wifiQuality: 5,
        hasOutlets: true,
        noiseLevel: "loud",
        comment: "Very packed today!",
      },
    });

    return NextResponse.json({ success: true, venueId: venue.id });
  } catch (err) {
    console.error("[heatmap/seed] failed:", err);
    return NextResponse.json(
      { success: false, error: "Seeding failed" },
      { status: 500 },
    );
  }
}
