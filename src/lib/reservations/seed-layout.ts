import { prisma } from "@/lib/prisma";

const DEFAULT_SEATS = [
  { seatNumber: "D-01", type: "HOT_DESK", x: 70, y: 90, amenities: ["monitor", "power"] },
  { seatNumber: "D-02", type: "HOT_DESK", x: 180, y: 90, amenities: ["power"] },
  { seatNumber: "D-03", type: "HOT_DESK", x: 290, y: 90, amenities: ["monitor", "power"] },
  { seatNumber: "D-04", type: "HOT_DESK", x: 400, y: 90, amenities: ["power"] },
  { seatNumber: "D-05", type: "FIXED_DESK", x: 70, y: 200, amenities: ["monitor", "ergonomic-chair", "power"] },
  { seatNumber: "D-06", type: "FIXED_DESK", x: 180, y: 200, amenities: ["monitor", "ergonomic-chair", "power"] },
  { seatNumber: "D-07", type: "HOT_DESK", x: 290, y: 200, amenities: ["power"] },
  { seatNumber: "D-08", type: "HOT_DESK", x: 400, y: 200, amenities: ["monitor", "power"] },
  { seatNumber: "MR-A", type: "MEETING_ROOM", x: 70, y: 330, width: 180, height: 90, amenities: ["whiteboard", "display", "video-call"] },
  { seatNumber: "MR-B", type: "MEETING_ROOM", x: 300, y: 330, width: 180, height: 90, amenities: ["whiteboard", "display"] },
  { seatNumber: "PB-1", type: "PHONE_BOOTH", x: 520, y: 90, width: 56, height: 72, amenities: ["acoustic"] },
  { seatNumber: "PB-2", type: "PHONE_BOOTH", x: 520, y: 200, width: 56, height: 72, amenities: ["acoustic"] },
] as const;

export async function ensureVenueLayout(venueId: string) {
  const count = await prisma.venueSeat.count({
    where: { venueId },
  });

  if (count > 0) return;

  await prisma.venueSeat.createMany({
    data: DEFAULT_SEATS.map((seat) => ({
      venueId,
      seatNumber: seat.seatNumber,
      type: seat.type,
      x: seat.x,
      y: seat.y,
      width: "width" in seat ? seat.width : 72,
      height: "height" in seat ? seat.height : 48,
      amenities: [...seat.amenities],
    })),
    skipDuplicates: true,
  });
}
