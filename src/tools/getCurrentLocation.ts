import { tool } from "ai";
import { z } from "zod";

/**
 * Gets user's current geolocation using browser Geolocation API
 * Returns latitude and longitude coordinates
 */
export const getCurrentLocationTool = tool({
  description: `
    Get the user's current geographic location (latitude and longitude).
    Use this when the user says "near me" or doesn't specify a location.
    This will prompt the browser for location permission.
  `,
  inputSchema: z.object({
    highAccuracy: z.boolean().default(true).describe("Request high accuracy location"),
  }),
  execute: async ({ highAccuracy }) => {
    // NOTE: This tool should be implemented client-side since it requires browser API
    // This server-side version returns a signal for client-side execution
    return {
      success: false,
      requiresClientExecution: true,
      message: "Location must be requested from client browser",
      action: "REQUEST_GEOLOCATION",
      params: { highAccuracy },
    };
  },
});
