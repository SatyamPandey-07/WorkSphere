import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { claimWaitlistSeat } from "@/lib/waitlist";
import { apiError } from "@/lib/apiResponse";

type RouteContext = {
  params: Promise<{ waitlistId: string }>;
};

/**
 * POST /api/waitlist/[waitlistId]/claim
 * Converts a notified waitlist reservation into a confirmed booking.
 */
export async function POST(_req: Request, context: RouteContext) {
  const { userId } = await auth();
  if (!userId) {
    return apiError("Unauthorized", 401, "UNAUTHORIZED");
  }

  const { waitlistId } = await context.params;

  try {
    const result = await claimWaitlistSeat(waitlistId, userId);
    if (!result.success) {
      return apiError(result.error || "Failed to claim seat", 409, "CONFLICT");
    }

    return NextResponse.json({
      success: true,
      data: result,
      message: "Seat claimed and booking confirmed successfully!",
    });
  } catch (error: any) {
    return apiError(error.message || "Failed to claim waitlist seat", 500, "INTERNAL_ERROR");
  }
}
