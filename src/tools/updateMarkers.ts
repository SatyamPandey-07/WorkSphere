import { tool } from "ai";
import { z } from "zod";

/**
 * Updates map markers (venue pins)
 * This tool signals the UI to display venue markers on the map
 */
export const updateMarkersTool = tool({
  description: `
    Update the map markers to display venues. Each marker represents a work space.
    Use this to show search results on the map. Include all relevant venue details
    so markers can show name, rating, amenities, etc.
  `,
  inputSchema: z.object({
    markers: z.array(
      z.object({
        id: z.string(),
        position: z.object({
          lat: z.number(),
          lng: z.number(),
        }),
        name: z.string(),
        category: z.string().optional(),
        rating: z.number().optional(),
        wifiQuality: z.number().optional(),
        hasOutlets: z.boolean().optional(),
        noiseLevel: z.string().optional(),
        distance: z.string().optional(),
        address: z.string().optional(),
        score: z.number().optional(),
      })
    ).describe("Array of venue markers to display on map"),
    action: z.enum(["replace", "add", "remove"]).default("replace")
      .describe("How to update markers: replace all, add to existing, or remove specific"),
  }),
  execute: async ({ markers, action }) => {
    // This is a UI-side tool - return data for client to process
    return {
      success: true,
      action: "UPDATE_MARKERS",
      data: {
        markers,
        action,
      },
      message: `${action === "replace" ? "Showing" : action === "add" ? "Added" : "Removed"} ${markers.length} venue${markers.length !== 1 ? "s" : ""} on map`,
    };
  },
});
