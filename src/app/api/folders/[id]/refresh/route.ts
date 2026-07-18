import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { hasFolderAccess } from "@/lib/folders";

// POST /api/folders/[id]/refresh - Trigger partykit refresh for folder
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Verify access before allowing them to trigger a refresh
    const { folder, hasAccess } = await hasFolderAccess(id, userId);
    if (!folder) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    if (!hasAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const partyKitUrl =
      process.env.NEXT_PUBLIC_PARTYKIT_URL || "http://127.0.0.1:1999";
    const endpoint = `${partyKitUrl}/parties/main/folder-${id}`;

    // Perform server-to-server best-effort call
    // Note: Use an internal AbortController to ensure this doesn't hang the route response
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000); // 2 second timeout

    try {
      await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ type: "refresh" }),
        signal: controller.signal,
      });
    } catch (e) {
      console.warn("PartyKit server unreachable, refresh omitted.", e);
    } finally {
      clearTimeout(timeoutId);
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error(`POST /api/folders/refresh error:`, error);
    return NextResponse.json(
      { error: "Failed to trigger folder refresh" },
      { status: 500 },
    );
  }
}
