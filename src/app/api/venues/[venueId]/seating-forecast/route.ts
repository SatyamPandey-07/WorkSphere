import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/apiResponse";

/**
 * Clamps forecast occupancy percentage values strictly to the [0, 100] range.
 * Applies Math.min(100, Math.max(0, val)) to handle raw predictive polynomial model
 * outputs and extreme booking variance.
 */
export function clampForecastOccupancy(val: number): number {
  if (typeof val !== "number" || isNaN(val)) {
    return 0;
  }
  return Math.min(100, Math.max(0, val));
}

function parseTimeMinutes(time: string): number | null {
  const match = time.match(/^(\d{1,2}):(\d{2})/);
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
  return hour * 60 + minute;
}

function isBookingActiveInHour(
  bookingTime: string,
  bookingDuration: number | null,
  targetHour: number,
): boolean {
  const start = parseTimeMinutes(bookingTime);
  if (start === null) return false;

  const duration = Number(bookingDuration ?? 60);
  if (!Number.isFinite(duration) || duration <= 0) return false;

  const bookingEnd = start + duration;
  const hourStart = targetHour * 60;
  const hourEnd = hourStart + 60;

  return start < hourEnd && bookingEnd > hourStart;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ venueId: string }> },
) {
  try {
    const { venueId } = await params;

    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
      select: {
        id: true,
        maxCapacity: true,
        _count: {
          select: { seats: true },
        },
      },
    });

    if (!venue) {
      return apiError("Venue not found", 404, "VENUE_NOT_FOUND");
    }

    // Determine authoritative capacity: prefer configured seats count, fallback to maxCapacity
    const seatCount = venue._count?.seats ?? 0;
    const maxCapacity = seatCount > 0 ? seatCount : venue.maxCapacity || 50;

    const url = new URL(request.url);
    const targetDateStr =
      url.searchParams.get("date") || new Date().toISOString().slice(0, 10);
    const targetDate = new Date(`${targetDateStr}T00:00:00Z`);
    const targetDayOfWeek = targetDate.getUTCDay();

    // Query active non-cancelled bookings for this venue
    // Only CONFIRMED, CHECKED_IN, and PENDING statuses represent utilization
    const bookings = await prisma.booking.findMany({
      where: {
        venueId,
        status: { in: ["CONFIRMED", "CHECKED_IN", "PENDING"] },
      },
      select: {
        date: true,
        time: true,
        duration: true,
      },
    });

    // Partition bookings into:
    // 1. Direct scheduled bookings for the target date
    // 2. Historical bookings on other dates sharing the same day-of-week
    const targetDateBookings: typeof bookings = [];
    const historicalDayBookings: typeof bookings = [];
    const historicalDates = new Set<string>();

    for (const b of bookings) {
      if (b.date === targetDateStr) {
        targetDateBookings.push(b);
      } else {
        const bDate = new Date(`${b.date}T00:00:00Z`);
        if (!isNaN(bDate.getTime()) && bDate.getUTCDay() === targetDayOfWeek) {
          historicalDayBookings.push(b);
          historicalDates.add(b.date);
        }
      }
    }

    const uniqueHistoricalDays = historicalDates.size;
    const totalSampleCount =
      targetDateBookings.length + historicalDayBookings.length;

    // Calculate confidence based on historical coverage and sample size (0.0 to 1.0)
    // Insufficient historical data has low confidence rather than a manufactured constant
    let confidence = 0.0;
    if (uniqueHistoricalDays >= 3 || targetDateBookings.length >= 5) {
      confidence = Math.min(
        0.95,
        Number(
          (
            0.5 +
            uniqueHistoricalDays * 0.1 +
            targetDateBookings.length * 0.05
          ).toFixed(2),
        ),
      );
    } else if (totalSampleCount > 0) {
      confidence = Math.min(
        0.65,
        Number((0.2 + totalSampleCount * 0.05).toFixed(2)),
      );
    } else {
      confidence = 0.1; // Baseline transparent low confidence for insufficient data
    }

    const forecast = [];

    for (let hour = 0; hour < 24; hour++) {
      // 1. Count active scheduled bookings for this hour on target date
      let scheduledCount = 0;
      for (const b of targetDateBookings) {
        if (isBookingActiveInHour(b.time, b.duration, hour)) {
          scheduledCount++;
        }
      }

      // 2. Calculate average historical utilization for this hour on the same day-of-week
      let historicalAvg = 0;
      if (uniqueHistoricalDays > 0) {
        let historicalCountForHour = 0;
        for (const b of historicalDayBookings) {
          if (isBookingActiveInHour(b.time, b.duration, hour)) {
            historicalCountForHour++;
          }
        }
        historicalAvg = historicalCountForHour / uniqueHistoricalDays;
      }

      // Combine scheduled with historical baseline
      let estimatedOccupancy = 0;
      let dataSource: "SCHEDULED" | "HISTORICAL_AVERAGE" | "INSUFFICIENT_DATA" =
        "INSUFFICIENT_DATA";

      if (scheduledCount > 0 && uniqueHistoricalDays > 0) {
        estimatedOccupancy = Math.max(
          scheduledCount,
          Math.round(historicalAvg),
        );
        dataSource = "SCHEDULED";
      } else if (scheduledCount > 0) {
        estimatedOccupancy = scheduledCount;
        dataSource = "SCHEDULED";
      } else if (uniqueHistoricalDays > 0) {
        estimatedOccupancy = Math.round(historicalAvg);
        dataSource = "HISTORICAL_AVERAGE";
      } else {
        estimatedOccupancy = 0;
        dataSource = "INSUFFICIENT_DATA";
      }

      const predictedOccupancy = Math.min(
        maxCapacity,
        Math.max(0, estimatedOccupancy),
      );
      const rawPercentage = (predictedOccupancy / maxCapacity) * 100;
      const occupancyPercentage = clampForecastOccupancy(rawPercentage);

      forecast.push({
        hour,
        predictedOccupancy,
        occupancyPercentage,
        confidence,
        capacity: maxCapacity,
        dataSource,
      });
    }

    // Recommended hours: lowest predicted occupancy during typical working hours (09:00 - 17:00)
    const businessHours = forecast.filter((f) => f.hour >= 9 && f.hour <= 17);
    businessHours.sort((a, b) => a.predictedOccupancy - b.predictedOccupancy);

    const recommendedHours = businessHours.slice(0, 3).map((f) => f.hour);

    return NextResponse.json({
      forecast,
      recommendedHours,
      capacity: maxCapacity,
    });
  } catch (error) {
    console.error("Error generating seating forecast:", error);
    return apiError("Internal server error", 500, "INTERNAL_ERROR");
  }
}
