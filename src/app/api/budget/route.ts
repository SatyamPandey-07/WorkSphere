import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { workspaceBudgetService } from "@/lib/billing/budgetService";

/**
 * GET /api/budget
 * Fetches user's current month workspace budget summary and team allocations.
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    const effectiveUserId = userId || "guest-user";

    const { searchParams } = new URL(request.url);
    const month = searchParams.get("month") || undefined;

    const summary = workspaceBudgetService.getBudgetSummary(effectiveUserId, month);

    return NextResponse.json({
      success: true,
      summary,
    });
  } catch (error) {
    console.error("[GET /api/budget] Error:", error);
    return NextResponse.json(
      { error: "Failed to retrieve monthly workspace budget." },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/budget
 * Updates monthly budget limit, warning threshold, or department allocations.
 */
export async function PATCH(request: NextRequest) {
  try {
    const { userId } = await auth();
    const effectiveUserId = userId || "guest-user";

    const body = await request.json().catch(() => ({}));
    const { monthlyLimit, warningThresholdPercentage, departments } = body;

    const updated = workspaceBudgetService.updateBudget(effectiveUserId, {
      monthlyLimit: typeof monthlyLimit === "number" ? monthlyLimit : undefined,
      warningThresholdPercentage:
        typeof warningThresholdPercentage === "number" ? warningThresholdPercentage : undefined,
      departments: Array.isArray(departments) ? departments : undefined,
    });

    const summary = workspaceBudgetService.getBudgetSummary(effectiveUserId, updated.month);

    return NextResponse.json({
      success: true,
      message: "Monthly workspace budget updated successfully.",
      summary,
    });
  } catch (error) {
    console.error("[PATCH /api/budget] Error:", error);
    return NextResponse.json(
      { error: "Failed to update budget settings." },
      { status: 500 },
    );
  }
}
