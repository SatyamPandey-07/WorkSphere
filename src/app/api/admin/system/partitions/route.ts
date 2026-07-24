import { NextResponse } from "next/server";
import { checkPartitionHealth } from "../../../../../lib/partitionMaintenance";

export async function GET() {
  try {
    const healthReport = await checkPartitionHealth();
    
    const statusCode = healthReport.status === "CRITICAL" ? 500 : 200;
    
    return NextResponse.json(healthReport, { status: statusCode });
  } catch (error) {
    console.error("Failed to fetch partition health report:", error);
    return NextResponse.json(
      { error: "Internal Server Error monitoring partitions" },
      { status: 500 }
    );
  }
}