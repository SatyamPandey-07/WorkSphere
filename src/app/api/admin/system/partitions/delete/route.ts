import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/admin";
import { bulkDeleteVenuePartitions } from "@/lib/adminPartitionService";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const admin = await getAdminUser();
    if (!admin) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403 },
      );
    }

    const body = await request.json().catch(() => ({}));
    const partitions = body.partitions;

    if (!Array.isArray(partitions) || partitions.length === 0) {
      return NextResponse.json(
        { error: "Partitions array is required and must not be empty" },
        { status: 400 },
      );
    }

    const result = await bulkDeleteVenuePartitions(partitions, admin.id);

    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    console.error("[Admin Bulk Partition Delete] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error during bulk delete" },
      { status: 500 },
    );
  }
}
