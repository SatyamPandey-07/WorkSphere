import { NextResponse } from "next/server";

// Simulating an in-memory database to store amenity votes dynamically for testing
const globalVoteCache: Record<string, { upvotes: number; downvotes: number }> = {};

export async function POST(request: Request) {
  try {
    const { venueId, amenity, isUpvote } = await request.json();

    if (!venueId || !amenity) {
      return NextResponse.json({ success: false, error: "Missing required parameters" }, { status: 400 });
    }

    const cacheKey = `${venueId}-${amenity}`;
    
    // Initialize weights if they don't exist yet
    if (!globalVoteCache[cacheKey]) {
      globalVoteCache[cacheKey] = { upvotes: 10, downvotes: 2 }; // Start with a safe 83% confidence
    }

    // Increment based on user choice
    if (isUpvote) {
      globalVoteCache[cacheKey].upvotes += 1;
    } else {
      globalVoteCache[cacheKey].downvotes += 1;
    }

    const { upvotes, downvotes } = globalVoteCache[cacheKey];
    const totalVotes = upvotes + downvotes;
    const confidenceScore = totalVotes > 0 ? (upvotes / totalVotes) * 100 : 100;

    return NextResponse.json({
      success: true,
      amenity,
      upvotes,
      downvotes,
      confidenceScore: Math.round(confidenceScore)
    });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
