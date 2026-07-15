import { useState } from 'react';
import { fetchOSRMRoute } from '@/lib/osrmService';

export function useMapDirections() {
  const [routeData, setRouteData] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  const calculateRoute = async (
    start: { lat: number; lng: number },
    end: { lat: number; lng: number },
    profile: "driving" | "walking" | "cycling" = "driving",
  ) => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const data = await fetchOSRMRoute(start, end, profile);
      setRouteData(data);
    } catch (error: any) {
      console.warn('Routing system intercepted a connection block:', error.message);
      // Surface the clean text alert cleanly to the UI state overlay
      setErrorMessage(error.message || 'An unexpected routing error occurred.');
      setRouteData(null);
    } finally {
      setIsLoading(false);
    }
  };

  return { routeData, errorMessage, isLoading, calculateRoute };
}
