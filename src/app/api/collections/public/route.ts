import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest) {
  try {
    const { userId } = await auth();

    // Fetch all public folders sorted by upvotes descending
    const publicFolders = await prisma.folder.findMany({
      where: {
        isPublic: true,
      },
      include: {
        _count: {
          select: { venues: true, members: true },
        },
        owner: {
          select: { id: true, firstName: true, lastName: true, imageUrl: true },
        },
        upvoteRefs: userId
          ? {
              where: { userId },
            }
          : false,
      },
      orderBy: [{ upvotes: "desc" }, { createdAt: "desc" }],
    });

    // Map to include hasUpvoted flag
    const foldersWithVoteState = publicFolders.map((folder) => {
      const { upvoteRefs, ...rest } = folder as any;
      return {
        ...rest,
        hasUpvoted: Array.isArray(upvoteRefs) && upvoteRefs.length > 0,
      };
    });

    return NextResponse.json({ folders: foldersWithVoteState });
  } catch (error) {
    console.error("GET /api/collections/public error:", error);
    return NextResponse.json(
      { error: "Failed to fetch public collections" },
      { status: 500 },
    );
  }
}
