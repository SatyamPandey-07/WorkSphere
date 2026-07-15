import { NextRequest, NextResponse } from "next/server";
import { getJobStatus } from "@/lib/queue";
import { auth } from "@clerk/nextjs/server";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ jobId: string }> }
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await context.params;
    
    if (!jobId) {
      return NextResponse.json({ error: "Job ID required" }, { status: 400 });
    }

    const status = await getJobStatus(jobId);

    if (!status) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json(status, { status: 200 });
  } catch (error: any) {
    console.error("[Job Status Error]:", error);
    return NextResponse.json(
      { error: "Failed to retrieve job status" },
      { status: 500 }
    );
  }
}
