import { tool } from "ai";
import { z } from "zod";
import axios from "axios";

/**
 * Converts coordinates to a human-readable address
 * Uses Nominatim (OpenStreetMap) reverse geocoding API
 */
export const reverseGeocodeTool = tool({
  description: `
    Convert latitude/longitude coordinates to a human-readable address.
    Useful for showing the user where they are or describing venue locations.
  `,
  parameters: z.object({
    latitude: z.number().describe("Latitude coordinate"),
    longitude: z.number().describe("Longitude coordinate"),
  }),
  execute: async ({ latitude, longitude }) => {
    try {
      const response = await axios.get(
        "https://nominatim.openstreetmap.org/reverse",
        {
          params: {
            format: "json",
            lat: latitude,
            lon: longitude,
            zoom: 18,
          },
          headers: {
            "User-Agent": "WorkHub/1.0", // Required by Nominatim
          },
          timeout: 5000,
        }
      );

      const data = response.data;
      
      return {
        success: true,
        address: {
          full: data.display_name,
          city: data.address.city || data.address.town || data.address.village,
          state: data.address.state,
          country: data.address.country,
          neighborhood: data.address.neighbourhood || data.address.suburb,
          road: data.address.road,
        },
        formatted: formatAddress(data.address),
      };
    } catch (error: any) {
      console.error("Reverse geocoding error:", error);
      return {
        success: false,
        error: error.message || "Failed to reverse geocode",
        formatted: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
      };
    }
  },
});

// Helper: Format address nicely
function formatAddress(address: any): string {
  const parts = [];
  
  if (address.road) parts.push(address.road);
  if (address.neighbourhood || address.suburb) {
    parts.push(address.neighbourhood || address.suburb);
  }
  if (address.city || address.town || address.village) {
    parts.push(address.city || address.town || address.village);
  }
  
  return parts.length > 0 ? parts.join(", ") : address.display_name;
}
