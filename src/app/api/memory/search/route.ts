import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { searchUserMemories } from "@/lib/memory";

export const dynamic = "force-dynamic";

/**
 * POST /api/memory/search
 * Semantically searches user memories using pgvector cosine distance and HNSW graph indexing.
 */
export async function POST(req: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { query, limit = 5, threshold = 0.4 } = body;

    // Bound the query before it reaches paid embedding generation, and
    // clamp the numeric options before they reach the SQL LIMIT and the
    // in-memory fallback, neither of which handles NaN deliberately.
    const MAX_QUERY_LENGTH = 1000;
    const MAX_LIMIT = 50;

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "Query string is required" },
        { status: 400 }
      );
    }

    if (query.length > MAX_QUERY_LENGTH) {
      return NextResponse.json(
        { error: "Query string exceeds maximum length" },
        { status: 400 }
      );
    }

    const parsedLimit = Number(limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_LIMIT) {
      return NextResponse.json(
        { error: "Limit must be an integer between 1 and 50" },
        { status: 400 }
      );
    }

    const parsedThreshold = Number(threshold);
    if (!Number.isFinite(parsedThreshold) || parsedThreshold < 0 || parsedThreshold > 1) {
      return NextResponse.json(
        { error: "Threshold must be a number between 0 and 1" },
        { status: 400 }
      );
    }

    const memories = await searchUserMemories(userId, query, {
      limit: parsedLimit,
      similarityThreshold: parsedThreshold,
    });

    return NextResponse.json({
      success: true,
      query,
      count: memories.length,
      memories,
    });
  } catch (error: unknown) {
    console.error("[Memory Search Error]:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        details: error instanceof Error ? error.message : "Failed to search memories",
      },
      { status: 500 }
    );
  }
}
