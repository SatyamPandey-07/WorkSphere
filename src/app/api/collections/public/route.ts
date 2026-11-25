import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const DEFAULT_PUBLIC_COLLECTIONS_LIMIT = 20;
export const MAX_PUBLIC_COLLECTIONS_LIMIT = 50;

const cursorPayloadSchema = z.object({
  upvotes: z.number().int().min(0),
  createdAt: z
    .string()
    .refine((val) => !Number.isNaN(new Date(val).getTime()), "Invalid date"),
  id: z.string().min(1),
});

export interface PublicCollectionsCursor {
  upvotes: number;
  createdAt: string;
  id: string;
}

export function encodePublicCollectionsCursor(item: {
  upvotes: number;
  createdAt: Date | string;
  id: string;
}): string {
  const payload: PublicCollectionsCursor = {
    upvotes: item.upvotes,
    createdAt:
      item.createdAt instanceof Date
        ? item.createdAt.toISOString()
        : new Date(item.createdAt).toISOString(),
    id: item.id,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodePublicCollectionsCursor(
  rawCursor: string,
): PublicCollectionsCursor | null {
  try {
    const json = Buffer.from(rawCursor, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    const result = cursorPayloadSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function parseLimitParam(rawLimit: string | null): number | null {
  if (rawLimit === null || rawLimit.trim() === "") {
    return DEFAULT_PUBLIC_COLLECTIONS_LIMIT;
  }
  const trimmed = rawLimit.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return null;
  }
  return Math.min(parsed, MAX_PUBLIC_COLLECTIONS_LIMIT);
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await auth();
    const { searchParams } = new URL(req.url);

    const limit = parseLimitParam(searchParams.get("limit"));
    if (limit === null) {
      return NextResponse.json(
        { error: "limit must be a positive integer" },
        { status: 400 },
      );
    }

    const rawCursor = searchParams.get("cursor")?.trim() || null;
    let decodedCursor: PublicCollectionsCursor | null = null;
    if (rawCursor) {
      decodedCursor = decodePublicCollectionsCursor(rawCursor);
      if (!decodedCursor) {
        return NextResponse.json(
          { error: "Invalid pagination cursor" },
          { status: 400 },
        );
      }
    }

    const where: Prisma.FolderWhereInput = {
      isPublic: true,
    };

    if (decodedCursor) {
      const cursorCreatedAt = new Date(decodedCursor.createdAt);
      where.OR = [
        { upvotes: { lt: decodedCursor.upvotes } },
        {
          upvotes: decodedCursor.upvotes,
          createdAt: { lt: cursorCreatedAt },
        },
        {
          upvotes: decodedCursor.upvotes,
          createdAt: cursorCreatedAt,
          id: { lt: decodedCursor.id },
        },
      ];
    }

    // Fetch limit + 1 records ordered deterministically to compute hasMore accurately
    const rows = await prisma.folder.findMany({
      where,
      take: limit + 1,
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
      orderBy: [{ upvotes: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && pageRows.length > 0
        ? encodePublicCollectionsCursor(pageRows[pageRows.length - 1])
        : null;

    // Map to include hasUpvoted flag
    const foldersWithVoteState = pageRows.map((folder) => {
      const { upvoteRefs, ...rest } = folder as any;
      return {
        ...rest,
        hasUpvoted: Array.isArray(upvoteRefs) && upvoteRefs.length > 0,
      };
    });

    return NextResponse.json({
      folders: foldersWithVoteState,
      pagination: {
        hasMore,
        nextCursor,
      },
    });
  } catch (error) {
    console.error("GET /api/collections/public error:", error);
    return NextResponse.json(
      { error: "Failed to fetch public collections" },
      { status: 500 },
    );
  }
}
