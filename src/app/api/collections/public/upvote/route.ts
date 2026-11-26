import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { rateLimit, getRateLimitInfo } from "@/lib/rateLimit";
import { z } from "zod";

const UPVOTE_RATE_LIMIT = 5;
const MAX_CONCURRENCY_RETRIES = 3;

const upvoteSchema = z.object({
  folderId: z.string().trim().min(1, "Folder ID is required"),
  upvote: z.boolean().optional(),
});

class DomainError extends Error {
  constructor(
    public readonly code: "NOT_FOUND" | "NOT_PUBLIC",
    message: string,
  ) {
    super(message);
  }
}

function getPrismaErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

async function readCommittedUpvoteState(folderId: string, userId: string) {
  const [folder, existingUpvote] = await Promise.all([
    prisma.folder.findUnique({
      where: { id: folderId },
      select: { isPublic: true, upvotes: true },
    }),
    prisma.folderUpvote.findUnique({
      where: {
        folderId_userId: {
          folderId,
          userId,
        },
      },
      select: { id: true },
    }),
  ]);

  if (!folder) {
    throw new DomainError("NOT_FOUND", "Collection not found");
  }
  if (!folder.isPublic) {
    throw new DomainError("NOT_PUBLIC", "Cannot vote on private collections");
  }

  return {
    hasUpvoted: Boolean(existingUpvote),
    upvotes: Math.max(0, folder.upvotes),
  };
}

async function executeUpvoteTransition(
  folderId: string,
  userId: string,
  desiredUpvote?: boolean,
): Promise<{ hasUpvoted: boolean; upvotes: number }> {
  for (let attempt = 0; attempt < MAX_CONCURRENCY_RETRIES; attempt += 1) {
    try {
      const txOutcome = await prisma.$transaction(async (tx) => {
        const folder = await tx.folder.findUnique({
          where: { id: folderId },
          select: { id: true, isPublic: true, upvotes: true },
        });

        if (!folder) {
          throw new DomainError("NOT_FOUND", "Collection not found");
        }
        if (!folder.isPublic) {
          throw new DomainError(
            "NOT_PUBLIC",
            "Cannot vote on private collections",
          );
        }

        const existingUpvote = await tx.folderUpvote.findUnique({
          where: {
            folderId_userId: {
              folderId,
              userId,
            },
          },
          select: { id: true },
        });

        const shouldAdd =
          desiredUpvote !== undefined ? desiredUpvote : !existingUpvote;

        if (shouldAdd && existingUpvote) {
          return {
            settled: true as const,
            hasUpvoted: true,
            upvotes: Math.max(0, folder.upvotes),
          };
        }

        if (!shouldAdd && !existingUpvote) {
          return {
            settled: true as const,
            hasUpvoted: false,
            upvotes: Math.max(0, folder.upvotes),
          };
        }

        if (shouldAdd) {
          const inserted = await tx.folderUpvote.createMany({
            data: [{ folderId, userId }],
            skipDuplicates: true,
          });

          if (inserted.count === 0) {
            return { settled: false as const };
          }

          const updatedFolder = await tx.folder.update({
            where: { id: folderId },
            data: { upvotes: { increment: 1 } },
            select: { upvotes: true },
          });

          return {
            settled: true as const,
            hasUpvoted: true,
            upvotes: Math.max(0, updatedFolder.upvotes),
          };
        }

        const deleted = await tx.folderUpvote.deleteMany({
          where: { folderId, userId },
        });

        if (deleted.count === 0) {
          return { settled: false as const };
        }

        const updatedFolder = await tx.folder.update({
          where: { id: folderId },
          data: { upvotes: { decrement: 1 } },
          select: { upvotes: true },
        });

        if (updatedFolder.upvotes < 0) {
          await tx.folder.updateMany({
            where: { id: folderId, upvotes: { lt: 0 } },
            data: { upvotes: 0 },
          });
        }

        return {
          settled: true as const,
          hasUpvoted: false,
          upvotes: Math.max(0, updatedFolder.upvotes),
        };
      });

      if (txOutcome.settled) {
        return {
          hasUpvoted: txOutcome.hasUpvoted,
          upvotes: txOutcome.upvotes,
        };
      }

      return readCommittedUpvoteState(folderId, userId);
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }

      const prismaCode = getPrismaErrorCode(error);
      if (prismaCode === "P2002") {
        return readCommittedUpvoteState(folderId, userId);
      }
      if (prismaCode === "P2034" && attempt + 1 < MAX_CONCURRENCY_RETRIES) {
        continue;
      }
      throw error;
    }
  }

  return readCommittedUpvoteState(folderId, userId);
}

export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const allowed = await rateLimit(`upvote:${userId}`, UPVOTE_RATE_LIMIT);
    if (!allowed) {
      const info = await getRateLimitInfo?.(
        `upvote:${userId}`,
        UPVOTE_RATE_LIMIT,
      );
      const retryAfter = info?.resetTime
        ? Math.max(1, Math.ceil((info.resetTime - Date.now()) / 1000))
        : 60;
      return NextResponse.json(
        { error: "Too many requests. Please slow down.", retryAfter },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request body" },
        { status: 400 },
      );
    }

    const validation = upvoteSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.format() },
        { status: 400 },
      );
    }

    const { folderId, upvote } = validation.data;
    const result = await executeUpvoteTransition(folderId, userId, upvote);

    return NextResponse.json({ success: true, ...result });
  } catch (error: unknown) {
    if (error instanceof DomainError) {
      if (error.code === "NOT_FOUND") {
        return NextResponse.json(
          { error: "Collection not found" },
          { status: 404 },
        );
      }
      if (error.code === "NOT_PUBLIC") {
        return NextResponse.json(
          { error: "Cannot vote on private collections" },
          { status: 400 },
        );
      }
    }
    console.error("POST /api/collections/public/upvote error:", error);
    return NextResponse.json(
      { error: "Failed to process upvote" },
      { status: 500 },
    );
  }
}
