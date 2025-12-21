import { tool } from "ai";
import { z } from "zod";
import axios from "axios";
import { Venue } from "@/types/venue";

/**
 * Finds work-friendly spaces (cafes, coworking, libraries) near a location
 * Uses Overpass API (OpenStreetMap) for free venue data
 */
export const findWorkSpacesTool = tool({
  description: `
    Find work-friendly venues like cafes, coworking spaces, and libraries near a location.
    Returns venues with basic info. Use this as the primary data source for venue discovery.
    Searches within specified radius (default 2000m).
  `,
  parameters: z.object({
    latitude: z.number().describe("Latitude of search center"),
    longitude: z.number().describe("Longitude of search center"),
    radius: z.number().default(2000).describe("Search radius in meters (default 2000)"),
    categories: z.array(z.enum(["cafe", "coworking", "library"]))
      .default(["cafe", "coworking", "library"])
      .describe("Types of venues to search for"),
  }),
  execute: async ({ latitude, longitude, radius, categories }) => {
    try {
      // Build Overpass query for OSM data
      const categoryQueries = [];
      
      if (categories.includes("cafe")) {
        categoryQueries.push('node["amenity"="cafe"](around:' + radius + ',' + latitude + ',' + longitude + ');');
      }
      if (categories.includes("coworking")) {
        categoryQueries.push('node["office"="coworking"](around:' + radius + ',' + latitude + ',' + longitude + ');');
        categoryQueries.push('node["amenity"="coworking_space"](around:' + radius + ',' + latitude + ',' + longitude + ');');
      }
      if (categories.includes("library")) {
        categoryQueries.push('node["amenity"="library"](around:' + radius + ',' + latitude + ',' + longitude + ');');
      }

      const query = `
        [out:json][timeout:25];
        (
          ${categoryQueries.join('\n          ')}
        );
        out body;
      `;

      const response = await axios.post(
        "https://overpass-api.de/api/interpreter",
        query,
        {
          headers: { "Content-Type": "text/plain" },
          timeout: 20000,
        }
      );

      const venues: Venue[] = response.data.elements.map((element: any) => {
        // Determine category
        let category: "cafe" | "coworking" | "library" = "cafe";
        if (element.tags.amenity === "library") category = "library";
        else if (element.tags.office === "coworking" || element.tags.amenity === "coworking_space") {
          category = "coworking";
        }

        // Calculate distance
        const distance = calculateDistance(
          latitude,
          longitude,
          element.lat,
          element.lon
        );

        return {
          id: element.id.toString(),
          placeId: `osm-${element.id}`,
          name: element.tags.name || `Unnamed ${category}`,
          latitude: element.lat,
          longitude: element.lon,
          category,
          address: formatAddress(element.tags),
          rating: element.tags.rating ? parseFloat(element.tags.rating) : undefined,
          wifiQuality: element.tags.wifi ? 4 : undefined, // Assume good if wifi tag present
          hasOutlets: element.tags.power_supply === "yes" || element.tags.socket !== undefined,
          noiseLevel: undefined, // Need crowdsourced data
          crowdsourced: false,
          distance,
          duration: Math.round((distance / 1000) * 15), // Rough estimate: 15 min per km
        };
      });

      // Sort by distance
      venues.sort((a, b) => (a.distance || 0) - (b.distance || 0));

      return {
        success: true,
        venues: venues.slice(0, 20), // Return top 20
        count: venues.length,
        searchParams: {
          latitude,
          longitude,
          radius,
          categories,
        },
      };
    } catch (error: any) {
      console.error("Error finding workspaces:", error);
      return {
        success: false,
        error: error.message || "Failed to fetch venues",
        venues: [],
        count: 0,
      };
    }
  },
});

// Helper: Calculate distance between two points (Haversine formula)
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

// Helper: Format address from OSM tags
function formatAddress(tags: any): string {
  const parts = [
    tags["addr:housenumber"],
    tags["addr:street"],
    tags["addr:city"],
  ].filter(Boolean);
  
  return parts.length > 0 ? parts.join(", ") : undefined;
}
