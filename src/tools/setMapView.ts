import { tool } from "ai";
import { z } from "zod";

/**
 * Updates map viewport (center position and zoom level)
 * Use this to focus the map on search results or specific areas
 */
export const setMapViewTool = tool({
  description: `
    Set the map's viewport to focus on a specific location and zoom level.
    Use this to center the map on search results, user location, or a specific venue.
    Optionally animate the transition.
  `,
  inputSchema: z.object({
    center: z.object({
      lat: z.number(),
      lng: z.number(),
    }).describe("Center coordinates for the map"),
    zoom: z.number().min(1).max(18).default(14)
      .describe("Zoom level (1=world, 18=building level). Default 14 for neighborhood view"),
    animate: z.boolean().default(true)
      .describe("Whether to animate the transition"),
  }),
  execute: async ({ center, zoom, animate }) => {
    return {
      success: true,
      action: "SET_MAP_VIEW",
      data: {
        center,
        zoom,
        animate,
      },
      message: animate 
        ? `Centering map on location` 
        : `Map view updated`,
    };
  },
});
