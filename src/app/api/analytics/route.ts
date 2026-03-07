import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAnalyticsSummaryAsync, getAgentMetrics, getPopularSearches } from "@/lib/analytics";

export const dynamic = "force-dynamic";

export async function GET() {
    try {
        // 1. Get Event Analytics from Redis/Memory
        const eventAnalytics = await getAnalyticsSummaryAsync();

        // 2. Get Database Stats
        const [
            venueCount,
            userCount,
            ratingCount,
            favoriteCount,
            conversationCount,
            latestVenues,
        ] = await Promise.all([
            prisma.venue.count(),
            prisma.user.count(),
            prisma.venueRating.count(),
            prisma.favorite.count(),
            prisma.conversation.count(),
            prisma.venue.findMany({
                take: 5,
                orderBy: { createdAt: "desc" },
                select: { id: true, name: true, category: true, createdAt: true }
            })
        ]);

        // 3. Get Category Distribution
        const categoryStats = await prisma.venue.groupBy({
            by: ["category"],
            _count: {
                id: true
            }
        });

        // 4. Get Social Stats (Ratings by category)
        const ratingStats = await prisma.venueRating.groupBy({
            by: ["noiseLevel"],
            _count: {
                id: true
            }
        });

        // 5. Agent Metrics
        const agentMetrics = getAgentMetrics();

        // 6. Search Patterns
        const popularSearches = getPopularSearches();

        return NextResponse.json({
            summary: {
                totalEvents: eventAnalytics.totalEvents,
                totalVenues: venueCount,
                totalUsers: userCount,
                totalRatings: ratingCount,
                totalFavorites: favoriteCount,
                totalConversations: conversationCount,
            },
            events: {
                counts: eventAnalytics.eventCounts,
                recent: eventAnalytics.recentEvents,
            },
            categories: categoryStats.map(s => ({
                name: s.category,
                count: s._count.id
            })),
            database: {
                latestVenues
            },
            agents: agentMetrics,
            searches: popularSearches,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error("Analytics API Error:", error);
        return NextResponse.json({ error: "Failed to fetch analytics" }, { status: 500 });
    }
}
