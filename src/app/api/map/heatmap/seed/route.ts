import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const todayStr = new Date().toISOString().split("T")[0];

    // 1. Create a mock venue near your current Silvassa coordinates if none exist
    let venue = await prisma.venue.findFirst({
      where: { name: "Neural Workspace Hub" }
    });

    if (!venue) {
      venue = await prisma.venue.create({
        data: {
          name: "Neural Workspace Hub",
          placeId: "mock-silvassa-1",
          latitude: 20.266,   // Match your current map center coordinate grid
          longitude: 73.016,
          category: "coworking",
          address: "Silvassa Center, DNH",
          rating: 4.8,
        }
      });
    }

    // 2. Inject active confirmed bookings for today to trigger high density weights
    await prisma.booking.createMany({
      data: [
        {
          userId: "user_mock_1", // Replace with a valid local User ID if you have strict foreign keys
          venueId: venue.id,
          date: todayStr,
          time: "10:00 AM",
          customerEmail: "tester@worksphere.com",
          confirmationId: `CONF-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
          status: "CONFIRMED"
        },
        {
          userId: "user_mock_2",
          venueId: venue.id,
          date: todayStr,
          time: "11:30 AM",
          customerEmail: "dev@worksphere.com",
          confirmationId: `CONF-${Math.random().toString(36).substr(2, 9).toUpperCase()}`,
          status: "CONFIRMED"
        }
      ],
      skipDuplicates: true
    });

    // 3. Inject a crowdsourced noise review to spike the heatmap color metric to purple
    await prisma.venueRating.create({
      data: {
        userId: "user_mock_1",
        venueId: venue.id,
        wifiQuality: 5,
        hasOutlets: true,
        noiseLevel: "loud",
        comment: "Very packed today!"
      }
    });

    return NextResponse.json({ success: true, message: "Database seeded for today successfully!" });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}