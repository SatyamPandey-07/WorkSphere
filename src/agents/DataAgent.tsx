import { Venue } from "@/types/venue";

/**
 * Data Agent
 * Fetches venue data and enriches it with crowdsourced information
 * Note: Actual API calls are made via tools in the chat endpoint
 * This agent structures the data response
 */

export interface DataAgentInput {
  venues: Venue[];
  searchParams: any;
  crowdsourcedData?: any;
}

export function dataAgent(input: DataAgentInput) {
  const { venues, searchParams, crowdsourcedData } = input;

  try {
    // Enrich venues with crowdsourced data if available
    const enrichedVenues = venues.map(venue => {
      if (crowdsourcedData && crowdsourcedData[venue.placeId]) {
        const crowd = crowdsourcedData[venue.placeId];
        return {
          ...venue,
          wifiQuality: crowd.wifiQuality || venue.wifiQuality,
          hasOutlets: crowd.hasOutlets !== undefined ? crowd.hasOutlets : venue.hasOutlets,
          noiseLevel: crowd.noiseLevel || venue.noiseLevel,
          crowdsourced: true,
        };
      }
      return venue;
    });

    return {
      type: "venues",
      data: enrichedVenues,
      conditions: {
        searchLocation: searchParams.location,
        radius: searchParams.radius,
        categories: searchParams.categories,
      },
      meta: {
        total: enrichedVenues.length,
        hasCrowdsourcedData: !!crowdsourcedData,
        timestamp: new Date().toISOString(),
      },
      success: true,
    };
  } catch (error) {
    console.error("Data agent error:", error);
    return {
      type: "error",
      data: [],
      error: error instanceof Error ? error.message : "Unknown error",
      success: false,
    };
  }
}

/**
 * Helper: Format data for Supermemory caching
 */
export function formatForCache(venues: Venue[], searchParams: any) {
  return {
    venues: venues.map(v => ({
      id: v.id,
      placeId: v.placeId,
      name: v.name,
      location: { lat: v.latitude, lng: v.longitude },
      category: v.category,
      amenities: {
        wifi: v.wifiQuality,
        outlets: v.hasOutlets,
        noise: v.noiseLevel,
      },
    })),
    searchParams,
    cachedAt: new Date().toISOString(),
  };
}
