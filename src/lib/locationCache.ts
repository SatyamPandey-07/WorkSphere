import { LRUCache } from "@/lib/cache";
export type LocationResult = {
  lat: number;
  lng: number;
  city: string;
  region: string;
  country: string;
  timezone?: string;
  source: string;
};
const LOCATION_CACHE_TTL_MS = 10 * 60 * 1000;
export const locationCache = new LRUCache<LocationResult>(
  1000,
  LOCATION_CACHE_TTL_MS,
);
export function clearLocationCache(): void {
  locationCache.clear();
}
