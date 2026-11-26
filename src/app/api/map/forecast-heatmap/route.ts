import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type VenueData = {
  id: string;
  latitude: number;
  longitude: number;
};

type ActiveBookingGroup = {
  venueId: string;
  _count: {
    id: number;
  };
};

type RatingData = {
  venueId: string;
  noiseLevel: string;
};

type BookingData = {
  date: string;
  time: string;
  duration: number | null;
  seatId: string | null;
};

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(dateString: string, amount: number) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return formatDate(date);
}

export function parseBookingInterval(booking: BookingData): {
  startMs: number;
  endMs: number;
} | null {
  if (!booking.date || !booking.time) return null;
  const match = booking.time.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const hourStr = String(hour).padStart(2, "0");
  const minuteStr = String(minute).padStart(2, "0");
  const isoString = `${booking.date}T${hourStr}:${minuteStr}:00Z`;
  const startMs = Date.parse(isoString);
  if (isNaN(startMs)) return null;

  const durationMinutes = Number(booking.duration ?? 60);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) return null;

  const endMs = startMs + durationMinutes * 60 * 1000;
  return { startMs, endMs };
}

export function isBookingActiveAtHour(
  booking: BookingData,
  date: string,
  hour: number,
): boolean {
  const interval = parseBookingInterval(booking);
  if (!interval) return false;

  const slotHour = String(hour).padStart(2, "0");
  const slotStartMs = Date.parse(`${date}T${slotHour}:00:00Z`);
  if (isNaN(slotStartMs)) return false;
  const slotEndMs = slotStartMs + 60 * 60 * 1000;

  return interval.startMs < slotEndMs && interval.endMs > slotStartMs;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const venueId = url.searchParams.get("venueId");
    const startDateParam = url.searchParams.get("startDate");

    /*
     * The original endpoint is also used by the map heatmap.
     * Preserve that response when venueId is not supplied.
     */
    if (!venueId) {
      const dayParam = url.searchParams.get("day");
      const hourParam = url.searchParams.get("hour");
      const day = dayParam !== null ? parseInt(dayParam, 10) : null;
      const hour = hourParam !== null ? parseInt(hourParam, 10) : null;

      const venues = await prisma.venue.findMany({
        select: {
          id: true,
          latitude: true,
          longitude: true,
        },
      });

      const todayStr = new Date().toISOString().split("T")[0];

      const activeBookings = await prisma.booking.groupBy({
        by: ["venueId"],
        where: {
          date: todayStr,
          status: "CONFIRMED",
        },
        _count: {
          id: true,
        },
      });

      const recentRatings = await prisma.venueRating.findMany({
        select: {
          venueId: true,
          noiseLevel: true,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: 100,
      });

      const heatmapPoints = (venues as VenueData[]).map((venue) => {
        const bookingCount =
          (activeBookings as ActiveBookingGroup[]).find(
            (booking) => booking.venueId === venue.id,
          )?._count.id || 0;

        const venueNoiseRatings = (recentRatings as RatingData[]).filter(
          (rating) => rating.venueId === venue.id,
        );

        let noiseScore = 0.2;

        if (venueNoiseRatings.length > 0) {
          const loudCount = venueNoiseRatings.filter(
            (rating) => rating.noiseLevel === "loud",
          ).length;

          const moderateCount = venueNoiseRatings.filter(
            (rating) => rating.noiseLevel === "moderate",
          ).length;

          noiseScore += loudCount * 0.4 + moderateCount * 0.2;
        }

        const weight = Math.min(0.1 + bookingCount * 0.2 + noiseScore, 1.0);

        return [venue.latitude, venue.longitude, weight];
      });

      return NextResponse.json({
        success: true,
        data: heatmapPoints,
        day,
        hour,
      });
    }

    const startDate =
      startDateParam && /^\d{4}-\d{2}-\d{2}$/.test(startDateParam)
        ? startDateParam
        : formatDate(new Date());

    const endDate = addDays(startDate, 6);

    const [venue, seats, bookings] = await Promise.all([
      prisma.venue.findUnique({
        where: { id: venueId },
        select: { id: true },
      }),

      prisma.venueSeat.findMany({
        where: {
          venueId,
          isEnabled: true,
        },
        select: {
          id: true,
        },
      }),

      prisma.booking.findMany({
        where: {
          venueId,
          date: {
            gte: addDays(startDate, -1),
            lte: endDate,
          },
          status: {
            in: ["CONFIRMED", "PENDING"],
          },
          seatId: {
            not: null,
          },
        },
        select: {
          date: true,
          time: true,
          duration: true,
          seatId: true,
        },
      }),
    ]);

    if (!venue) {
      return NextResponse.json(
        {
          success: false,
          error: "Venue not found",
        },
        { status: 404 },
      );
    }

    const capacity = seats.length;

    const data = [];

    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const date = addDays(startDate, dayOffset);

      for (let hour = 0; hour < 24; hour++) {
        const occupiedSeatIds = new Set(
          (bookings as BookingData[])
            .filter((booking) => isBookingActiveAtHour(booking, date, hour))
            .map((booking) => booking.seatId)
            .filter((seatId): seatId is string => Boolean(seatId)),
        );

        const occupancy =
          capacity > 0
            ? Math.min(100, Math.round((occupiedSeatIds.size / capacity) * 100))
            : 0;

        data.push({
          date,
          hour,
          occupancy,
        });
      }
    }

    return NextResponse.json({
      success: true,
      venueId,
      startDate,
      endDate,
      capacity,
      data,
    });
  } catch (error) {
    console.error("Forecast heatmap calculation failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Internal Server Error",
      },
      { status: 500 },
    );
  }
}
