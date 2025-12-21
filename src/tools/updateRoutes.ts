import { tool } from "ai";
import { z } from "zod";
import axios from "axios";

/**
 * Updates map routes (directions from user to venues)
 * Uses OSRM (Open Source Routing Machine) for free routing
 */
export const updateRoutesTool = tool({
  description: `
    Display route(s) on the map from user's location to selected venue(s).
    Shows walking/driving directions. Use this when user wants directions
    or to compare multiple route options.
  `,
  parameters: z.object({
    origin: z.object({
      lat: z.number(),
      lng: z.number(),
    }).describe("Starting point (usually user location)"),
    destinations: z.array(
      z.object({
        id: z.string(),
        lat: z.number(),
        lng: z.number(),
        name: z.string(),
      })
    ).describe("Array of destinations to route to"),
    mode: z.enum(["walking", "driving", "cycling"]).default("walking")
      .describe("Transportation mode"),
  }),
  execute: async ({ origin, destinations, mode }) => {
    try {
      // Use OSRM for free routing
      const routes = await Promise.all(
        destinations.map(async (dest) => {
          try {
            const profile = mode === "driving" ? "car" : mode === "cycling" ? "bike" : "foot";
            const url = `https://router.project-osrm.org/route/v1/${profile}/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=full&geometries=geojson`;
            
            const response = await axios.get(url, { timeout: 5000 });
            const route = response.data.routes[0];
            
            if (!route) return null;

            // Convert GeoJSON to lat/lng array
            const path = route.geometry.coordinates.map((coord: number[]) => ({
              lat: coord[1],
              lng: coord[0],
            }));

            return {
              id: `route-${dest.id}`,
              destinationId: dest.id,
              destinationName: dest.name,
              path,
              distance: route.distance, // meters
              duration: route.duration, // seconds
            };
          } catch (error) {
            console.error(`Error fetching route to ${dest.name}:`, error);
            return null;
          }
        })
      );

      const validRoutes = routes.filter(r => r !== null);

      return {
        success: true,
        action: "UPDATE_ROUTES",
        data: {
          routes: validRoutes,
          mode,
        },
        message: `Showing ${validRoutes.length} route${validRoutes.length !== 1 ? "s" : ""} (${mode})`,
      };
    } catch (error: any) {
      console.error("Error updating routes:", error);
      return {
        success: false,
        error: error.message || "Failed to calculate routes",
      };
    }
  },
});
