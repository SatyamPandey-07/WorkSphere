import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

/**
 * Gets detailed information about a specific venue
 * Checks local database for crowdsourced data (ratings, amenities)
 */
export const getVenueDetailsTool = tool({
  description: `
    Get detailed information about a specific venue including crowdsourced ratings,
    amenities (WiFi quality, outlets, noise level), and user reviews.
    Use this to enrich venue data with community feedback.
  `,
  inputSchema: z.object({
    venueId: z.string().describe("The ID of the venue to get details for"),
    placeId: z.string().describe("The place ID (for database lookup)"),
  }),
  execute: async ({ venueId: _venueId, placeId }) => {
    try {
      // Try to find venue in database with aggregated ratings
      const venue = await prisma.venue.findUnique({
        where: { placeId },
        include: {
          ratings: {
            orderBy: { createdAt: "desc" },
            take: 10, // Get latest 10 ratings
          },
          _count: {
            select: { favorites: true, ratings: true },
          },
        },
      });

      if (venue) {
        // Calculate average ratings from community data
        const avgWifi = venue.ratings.length > 0
          ? venue.ratings.reduce((sum, r) => sum + r.wifiQuality, 0) / venue.ratings.length
          : undefined;

        const outletPercentage = venue.ratings.length > 0
          ? (venue.ratings.filter(r => r.hasOutlets).length / venue.ratings.length) * 100
          : undefined;

        const noiseLevels = venue.ratings.map(r => r.noiseLevel);
        const dominantNoise = noiseLevels.length > 0
          ? getMostCommon(noiseLevels)
          : undefined;

        return {
          success: true,
          venue: {
            id: venue.id,
            placeId: venue.placeId,
            name: venue.name,
            latitude: venue.latitude,
            longitude: venue.longitude,
            category: venue.category,
            address: venue.address,
            rating: venue.rating,
            wifiQuality: Math.round(avgWifi || venue.wifiQuality || 0),
            hasOutlets: outletPercentage ? outletPercentage > 50 : venue.hasOutlets,
            noiseLevel: dominantNoise || venue.noiseLevel,
            crowdsourced: venue.ratings.length > 0,
            favoriteCount: venue._count.favorites,
            ratingCount: venue._count.ratings,
            recentReviews: venue.ratings.slice(0, 3).map(r => ({
              wifiQuality: r.wifiQuality,
              hasOutlets: r.hasOutlets,
              noiseLevel: r.noiseLevel,
              comment: r.comment,
              createdAt: r.createdAt.toISOString(),
            })),
          },
        };
      }

      // If not in database, return basic info
      return {
        success: true,
        venue: null,
        message: "Venue not found in database. No crowdsourced data available yet.",
      };
    } catch (error: any) {
      console.error("Error getting venue details:", error);
      return {
        success: false,
        error: error.message || "Failed to fetch venue details",
      };
    }
  },
});

// Helper: Find most common element in array
function getMostCommon(arr: string[]): string | undefined {
  if (arr.length === 0) return undefined;
  
  const counts: Record<string, number> = {};
  arr.forEach(item => {
    counts[item] = (counts[item] || 0) + 1;
  });

  return Object.entries(counts).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}
