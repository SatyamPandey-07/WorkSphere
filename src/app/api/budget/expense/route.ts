import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { workspaceBudgetService } from "@/lib/billing/budgetService";
import { expenseAllocationSchema, validateRequest } from "@/lib/validations";

/**
 * POST /api/budget/expense
 * Records a new workspace booking expense allocated to a department or cost center.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    const effectiveUserId = userId || "guest-user";

    const body = await request.json().catch(() => ({}));
    const validation = validateRequest(expenseAllocationSchema, body);

    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 },
      );
    }

    const { bookingId, venueName, category, department, costCenter, amount } = validation.data;

    const expense = workspaceBudgetService.addExpense(effectiveUserId, {
      bookingId,
      venueName,
      category: category || "Workspace Booking",
      department: department || "General",
      costCenter,
      amount,
    });

    const summary = workspaceBudgetService.getBudgetSummary(effectiveUserId);

    return NextResponse.json({
      success: true,
      message: "Workspace expense allocated successfully.",
      expense,
      summary,
    });
  } catch (error) {
    console.error("[POST /api/budget/expense] Error:", error);
    return NextResponse.json(
      { error: "Failed to record workspace expense." },
      { status: 500 },
    );
  }
}
