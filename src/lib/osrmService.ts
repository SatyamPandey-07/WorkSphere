interface RouteCoordinates {
  lat: number;
  lng: number;
}

/**
 * Fetches routing vectors from the OSRM engine with a strict timeout execution boundary.
 */
export async function fetchOSRMRoute(start: RouteCoordinates, end: RouteCoordinates) {
  // 1. Initialize the AbortController tracking interface
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // Strict 5-second boundary

  const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;

  try {
    const response = await fetch(url, { 
      signal: controller.signal,
      headers: { 'Accept': 'application/json' }
    });

    clearTimeout(timeoutId); // Clear timeout instantly upon successful resolution

    if (!response.ok) {
      throw new Error(`OSRM engine returned invalid status payload: ${response.status}`);
    }

    return await response.json();
  } catch (error: any) {
    clearTimeout(timeoutId);

    // 2. Explicitly catch the Abort Error thrown by the controller signal
    if (error.name === 'AbortError') {
      throw new Error('Network latency timeout. Unable to connect to routing servers.');
    }

    throw error;
  }
}