/**
 * Foursquare Places API integration
 * Provides venue photos, ratings, tips, hours, and more
 * Free: 50k calls/month with hard cap (no surprise bills)
 */

const FOURSQUARE_API_KEY = process.env.FOURSQUARE_API_KEY || process.env.NEXT_PUBLIC_FOURSQUARE_API_KEY;

export interface FoursquareVenue {
  fsq_id: string;
  name: string;
  location: {
    address?: string;
    formatted_address?: string;
    locality?: string;
    region?: string;
    country?: string;
  };
  categories: Array<{
    id: number;
    name: string;
    icon: { prefix: string; suffix: string };
  }>;
  distance?: number;
  geocodes?: {
    main: { latitude: number; longitude: number };
  };
  photos?: Array<{
    id: string;
    prefix: string;
    suffix: string;
    width: number;
    height: number;
  }>;
  rating?: number;
  price?: number;
  hours?: {
    display?: string;
    is_local_holiday?: boolean;
    open_now?: boolean;
  };
  stats?: {
    total_photos?: number;
    total_ratings?: number;
    total_tips?: number;
  };
  tips?: Array<{
    text: string;
    created_at: string;
  }>;
  tel?: string;
  website?: string;
  social_media?: {
    instagram?: string;
    twitter?: string;
  };
  features?: {
    payment?: { credit_cards?: boolean };
    food_and_drink?: { delivery?: boolean; takeout?: boolean };
    services?: { dine_in?: boolean };
    amenities?: { wifi?: string; outdoor_seating?: boolean };
  };
}

export interface FoursquareSearchResult {
  results: FoursquareVenue[];
}

/**
 * Search for nearby venues using Foursquare
 */
export async function searchVenues(
  lat: number,
  lng: number,
  options: {
    query?: string;
    categories?: string; // e.g., "13034,13035" for cafes
    radius?: number;
    limit?: number;
  } = {}
): Promise<FoursquareVenue[]> {
  if (!FOURSQUARE_API_KEY) {
    console.error('Foursquare API key not configured');
    return [];
  }

  const { query, categories, radius = 2000, limit = 20 } = options;

  const params = new URLSearchParams({
    ll: `${lat},${lng}`,
    radius: radius.toString(),
    limit: limit.toString(),
  });

  // Add query if provided (Foursquare v3 uses 'query' in params)
  if (query) params.append('query', query);
  // Foursquare category IDs: 13032=cafe, 13035=coffee, 12009=coworking, 12050=library
  if (categories) params.append('categories', categories);

  try {
    // Use the correct Foursquare v3 endpoint
    const response = await fetch(
      `https://api.foursquare.com/v3/places/search?${params}`,
      {
        headers: {
          Authorization: FOURSQUARE_API_KEY,
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Foursquare search failed:', response.status, errorText);
      return [];
    }

    const data: FoursquareSearchResult = await response.json();
    return data.results || [];
  } catch (error) {
    console.error('Foursquare search error:', error);
    return [];
  }
}

/**
 * Get detailed venue info including photos, tips, hours
 */
export async function getVenueDetails(fsqId: string): Promise<FoursquareVenue | null> {
  if (!FOURSQUARE_API_KEY) {
    console.error('Foursquare API key not configured');
    return null;
  }

  try {
    const response = await fetch(
      `https://api.foursquare.com/v3/places/${fsqId}?fields=fsq_id,name,location,categories,rating,price,hours,stats,tel,website,features,photos,tips`,
      {
        headers: {
          Authorization: FOURSQUARE_API_KEY,
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) {
      console.error('Foursquare details failed:', response.status);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Foursquare details error:', error);
    return null;
  }
}

/**
 * Get venue photos
 */
export async function getVenuePhotos(
  fsqId: string,
  limit: number = 5
): Promise<string[]> {
  if (!FOURSQUARE_API_KEY) {
    return [];
  }

  try {
    const response = await fetch(
      `https://api.foursquare.com/v3/places/${fsqId}/photos?limit=${limit}`,
      {
        headers: {
          Authorization: FOURSQUARE_API_KEY,
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) return [];

    const photos = await response.json();
    return photos.map((p: { prefix: string; suffix: string }) => 
      `${p.prefix}300x200${p.suffix}`
    );
  } catch {
    return [];
  }
}

/**
 * Get venue tips (user reviews)
 */
export async function getVenueTips(
  fsqId: string,
  limit: number = 3
): Promise<Array<{ text: string; createdAt: string }>> {
  if (!FOURSQUARE_API_KEY) {
    return [];
  }

  try {
    const response = await fetch(
      `https://api.foursquare.com/v3/places/${fsqId}/tips?limit=${limit}`,
      {
        headers: {
          Authorization: FOURSQUARE_API_KEY,
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) return [];

    const tips = await response.json();
    return tips.map((t: { text: string; created_at: string }) => ({
      text: t.text,
      createdAt: t.created_at,
    }));
  } catch {
    return [];
  }
}

/**
 * Helper: Build photo URL from Foursquare photo object
 */
export function buildPhotoUrl(
  prefix: string,
  suffix: string,
  size: string = '300x200'
): string {
  return `${prefix}${size}${suffix}`;
}

/**
 * Helper: Get price level as string
 */
export function getPriceLevel(price?: number): string {
  if (!price) return '';
  return '$'.repeat(price);
}

/**
 * Foursquare category IDs for workspaces
 */
export const WORKSPACE_CATEGORIES = {
  CAFE: '13032',
  COFFEE_SHOP: '13035',
  COWORKING: '12009',
  LIBRARY: '12050',
  ALL: '13032,13035,12009,12050',
};
