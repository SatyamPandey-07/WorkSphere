import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { hasFolderAccess } from "@/lib/folders";
import { encryptShareToken } from "@/lib/shareToken";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { collectionId } = await req.json();
    if (!collectionId) {
      return NextResponse.json(
        { error: "Missing collectionId" },
        { status: 400 },
      );
    }

    const { hasAccess, role } = await hasFolderAccess(collectionId, userId);

    // Check if the user is the owner
    if (!hasAccess || role !== "OWNER") {
      return NextResponse.json(
        { error: "Forbidden. Must be owner to share." },
        { status: 403 },
      );
    }

    const token = encryptShareToken({
      collectionId,
      permission: "view",
      issuedAt: Date.now(),
    });

    const url = new URL(req.url);
    const shareUrl = `${url.origin}/collections/public/${token}`;

    return NextResponse.json({ url: shareUrl });
  } catch (error) {
    console.error("Error creating share link:", error);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
