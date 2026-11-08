import { NextResponse } from "next/server";
import { getAllVenuePartitions } from "@/lib/adminPartitionService";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const summary = await getAllVenuePartitions();
    const statusCode = summary.status === "CRITICAL" ? 500 : 200;

    return NextResponse.json(summary, { status: statusCode });
  } catch (error) {
    console.error("Failed to fetch partition summary report:", error);
    return NextResponse.json(
      { error: "Internal Server Error monitoring partitions" },
      { status: 500 },
    );
  }
}
