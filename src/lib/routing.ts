/**
 * Get driving/walking route between two points using OSRM (Open Source Routing Machine)
 * Free, no API key required
 */

export interface RouteResult {
  path: Array<{ lat: number; lng: number }>;
  distance: number; // in meters
  duration: number; // in seconds
}

/**
 * Fetch route from OSRM public API
 * @param from Starting coordinates
 * @param to Destination coordinates
 * @param profile 'driving-car' | 'foot-walking' | 'cycling-regular'
 */
export async function getRoute(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  profile: 'driving' | 'walking' | 'cycling' = 'walking'
): Promise<RouteResult | null> {
  try {
    // OSRM uses lng,lat format (opposite of most APIs)
    const coords = `${from.lng},${from.lat};${to.lng},${to.lat}`;
    
    // Use public OSRM demo server (free, no API key)
    // For production, consider self-hosting or use paid service
    const url = `https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=geojson`;

    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      console.error('OSRM routing failed:', response.status);
      return null;
    }

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
      return null;
    }

    const route = data.routes[0];
    
    // Convert GeoJSON coordinates [lng, lat] to our format {lat, lng}
    const path = route.geometry.coordinates.map((coord: [number, number]) => ({
      lat: coord[1],
      lng: coord[0],
    }));

    return {
      path,
      distance: route.distance, // meters
      duration: route.duration, // seconds
    };
  } catch (error) {
    console.error('Error fetching route:', error);
    return null;
  }
}

/**
 * Alternative: OpenRouteService (requires free API key)
 * Sign up at https://openrouteservice.org/dev/#/signup
 */
export async function getRouteORS(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  profile: 'driving-car' | 'foot-walking' | 'cycling-regular' = 'foot-walking',
  apiKey?: string
): Promise<RouteResult | null> {
  if (!apiKey) {
    console.warn('OpenRouteService requires API key');
    return null;
  }

  try {
    const url = 'https://api.openrouteservice.org/v2/directions/' + profile;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': apiKey,
      },
      body: JSON.stringify({
        coordinates: [
          [from.lng, from.lat],
          [to.lng, to.lat],
        ],
      }),
    });

    if (!response.ok) {
      console.error('ORS routing failed:', response.status);
      return null;
    }

    const data = await response.json();
    const route = data.routes[0];

    // Convert coordinates
    const path = route.geometry.coordinates.map((coord: [number, number]) => ({
      lat: coord[1],
      lng: coord[0],
    }));

    return {
      path,
      distance: route.summary.distance,
      duration: route.summary.duration,
    };
  } catch (error) {
    console.error('Error fetching ORS route:', error);
    return null;
  }
}
