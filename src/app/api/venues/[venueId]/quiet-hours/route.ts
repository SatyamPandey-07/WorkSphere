import { NextResponse } from "next/server";
import { predictQuietHours } from "@/lib/quietHoursPrediction";
import { apiError } from "@/lib/apiResponse";

/**
 * GET /api/venues/[venueId]/quiet-hours
 *
 * Returns a quiet-hours prediction for the venue based on aggregated
 * historical noise ratings grouped by hour-of-day.
 *
 * Response:
 * {
 *   venueId: string,
 *   quietWindows: [{ startHour, endHour, avgDb }],
 *   peakHours: number[],
 *   summary: string,   // human-readable, suitable for AI context injection
 *   hourlyProfile: [{ hour, averageDb, label, samples }]
 * }
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ venueId: string }> },
) {
  const { venueId } = await params;

  if (!venueId) {
    return apiError("venueId is required", 400, "VALIDATION_FAILED");
  }

  try {
    const prediction = await predictQuietHours(venueId);
    return NextResponse.json(prediction);
  } catch (error) {
    console.error("[QuietHours] Prediction failed:", error);
    return apiError("Failed to predict quiet hours", 500, "INTERNAL_ERROR");
  }
}
