/**
 * Map Provider Interface
 *
 * Modular abstraction for map/directions providers and venue photo lookups.
 * Default implementation uses Google Maps for directions. Swap the provider
 * by implementing the MapProvider interface and updating `getMapProvider()`.
 *
 * Usage:
 *   const provider = getMapProvider();
 *   const link = provider.getDirectionsLink(lat, lng);
 *   const photo = await provider.getVenuePhoto(venueId);
 */

import type { DirectionsLink, VenueInfo } from "./types";

/**
 * Interface that all map providers must implement.
 */
export interface MapProvider {
  /** Name identifier for the provider (e.g., "google_maps", "mapbox") */
  readonly name: string;

  /**
   * Generate a directions link from the user's assumed location to the venue.
   * @param lat - Destination latitude
   * @param lng - Destination longitude
   * @param label - Human-readable label for the link
   */
  getDirectionsLink(lat: number, lng: number, label?: string): DirectionsLink;

  /**
   * Fetch a venue photo URL.
   * @param venue - Venue information (id, name, category used for lookup)
   * @returns URL string or undefined if no photo available
   */
  getVenuePhoto(
    venue: Pick<VenueInfo, "id" | "name" | "category">,
  ): Promise<string | undefined>;
}

// =============================================================================
// Google Maps Provider (default)
// =============================================================================

class GoogleMapsProvider implements MapProvider {
  readonly name = "google_maps";

  getDirectionsLink(lat: number, lng: number, label?: string): DirectionsLink {
    const destination = `${lat},${lng}`;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
    return {
      provider: this.name,
      url,
      label: label || "Open in Google Maps",
    };
  }

  async getVenuePhoto(
    venue: Pick<VenueInfo, "id" | "name" | "category">,
  ): Promise<string | undefined> {
    // Try to use Google Places API for photos if configured
    const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (googleApiKey && venue.name) {
      try {
        const searchUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(venue.name)}&inputtype=textquery&fields=photos&key=${googleApiKey}`;
        const response = await fetch(searchUrl);
        const data = await response.json();
        if (data.candidates?.[0]?.photos?.[0]?.photo_reference) {
          const photoRef = data.candidates[0].photos[0].photo_reference;
          return `https://maps.googleapis.com/maps/api/place/photo?maxwidth=800&photoreference=${photoRef}&key=${googleApiKey}`;
        }
      } catch (error) {
        console.warn("[MapProvider] Google Places photo lookup failed:", error);
      }
    }

    // Fallback: no photo available
    return undefined;
  }
}

// =============================================================================
// Provider Registry
// =============================================================================

const providers: Record<string, MapProvider> = {
  google_maps: new GoogleMapsProvider(),
};

/**
 * Get the active map provider.
 * Defaults to Google Maps. Override by setting MAP_PROVIDER env variable.
 */
export function getMapProvider(): MapProvider {
  const providerName = process.env.MAP_PROVIDER || "google_maps";
  const provider = providers[providerName];
  if (!provider) {
    console.warn(
      `[MapProvider] Unknown provider "${providerName}", falling back to Google Maps`,
    );
    return providers.google_maps;
  }
  return provider;
}

/**
 * Register a custom map provider at runtime.
 * Useful for tests or dynamic provider registration.
 */
export function registerMapProvider(name: string, provider: MapProvider): void {
  providers[name] = provider;
}

/**
 * Convenience: get a directions link for a venue.
 */
export function getVenueDirectionsLink(venue: {
  latitude: number;
  longitude: number;
  name: string;
}): DirectionsLink {
  const provider = getMapProvider();
  return provider.getDirectionsLink(
    venue.latitude,
    venue.longitude,
    `Directions to ${venue.name}`,
  );
}

/**
 * Convenience: get a venue photo URL.
 */
export async function getVenuePhoto(
  venue: Pick<VenueInfo, "id" | "name" | "category">,
): Promise<string | undefined> {
  const provider = getMapProvider();
  return provider.getVenuePhoto(venue);
}
