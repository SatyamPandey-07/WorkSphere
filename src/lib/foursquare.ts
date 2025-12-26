/**
 * Yelp Fusion API integration (replacing deprecated Foursquare)
 * Provides venue photos, ratings, reviews, hours, and more
 * Free: 5000 calls/day
 */

const YELP_API_KEY = process.env.YELP_API_KEY || process.env.NEXT_PUBLIC_YELP_API_KEY;

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
 * Search for nearby venues using Yelp Fusion API
 */
export async function searchVenues(
  lat: number,
  lng: number,
  options: {
    query?: string;
    categories?: string;
    radius?: number;
    limit?: number;
  } = {}
): Promise<FoursquareVenue[]> {
  if (!YELP_API_KEY) {
    console.error('Yelp API key not configured');
    return [];
  }

  const { query, radius = 2000, limit = 20 } = options;

  const params = new URLSearchParams({
    latitude: lat.toString(),
    longitude: lng.toString(),
    radius: Math.min(radius, 40000).toString(), // Yelp max is 40km
    limit: limit.toString(),
    sort_by: 'distance',
    categories: 'cafes,coffee,coworkingspaces,libraries',
  });

  if (query) params.append('term', query);

  try {
    const response = await fetch(
      `https://api.yelp.com/v3/businesses/search?${params}`,
      {
        headers: {
          Authorization: `Bearer ${YELP_API_KEY}`,
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Yelp search failed:', response.status, errorText);
      return [];
    }

    const data = await response.json();
    
    // Convert Yelp format to our FoursquareVenue format for compatibility
    return (data.businesses || []).map((b: any) => ({
      fsq_id: b.id,
      name: b.name,
      location: {
        address: b.location?.address1,
        formatted_address: b.location?.display_address?.join(', '),
        locality: b.location?.city,
        region: b.location?.state,
        country: b.location?.country,
      },
      categories: b.categories?.map((c: any) => ({
        id: 0,
        name: c.title,
        icon: { prefix: '', suffix: '' },
      })) || [],
      distance: b.distance,
      rating: b.rating ? b.rating * 2 : undefined, // Convert 5-star to 10-scale
      price: b.price?.length || undefined,
      hours: {
        open_now: !b.is_closed,
      },
      photos: b.image_url ? [{ 
        id: '1', 
        prefix: b.image_url.replace(/o\.jpg$/, ''), 
        suffix: 'o.jpg',
        width: 300,
        height: 200,
      }] : [],
      tel: b.phone,
      website: b.url,
    }));
  } catch (error) {
    console.error('Yelp search error:', error);
    return [];
  }
}

/**
 * Get detailed venue info from Yelp
 */
export async function getVenueDetails(yelpId: string): Promise<FoursquareVenue | null> {
  if (!YELP_API_KEY) {
    console.error('Yelp API key not configured');
    return null;
  }

  try {
    const response = await fetch(
      `https://api.yelp.com/v3/businesses/${yelpId}`,
      {
        headers: {
          Authorization: `Bearer ${YELP_API_KEY}`,
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) {
      console.error('Yelp details failed:', response.status);
      return null;
    }

    const b = await response.json();
    
    return {
      fsq_id: b.id,
      name: b.name,
      location: {
        address: b.location?.address1,
        formatted_address: b.location?.display_address?.join(', '),
        locality: b.location?.city,
        region: b.location?.state,
        country: b.location?.country,
      },
      categories: b.categories?.map((c: any) => ({
        id: 0,
        name: c.title,
        icon: { prefix: '', suffix: '' },
      })) || [],
      rating: b.rating ? b.rating * 2 : undefined,
      price: b.price?.length || undefined,
      hours: {
        open_now: !b.is_closed,
        display: b.hours?.[0]?.is_open_now ? 'Open Now' : 'Closed',
      },
      photos: b.photos?.map((url: string, i: number) => ({
        id: i.toString(),
        prefix: url.replace(/o\.jpg$/, ''),
        suffix: 'o.jpg',
        width: 300,
        height: 200,
      })) || [],
      tel: b.phone,
      website: b.url,
    };
  } catch (error) {
    console.error('Yelp details error:', error);
    return null;
  }
}

/**
 * Get venue photos from Yelp
 */
export async function getVenuePhotos(
  yelpId: string,
  limit: number = 5
): Promise<string[]> {
  const details = await getVenueDetails(yelpId);
  if (!details?.photos) return [];
  
  return details.photos.slice(0, limit).map(p => `${p.prefix}${p.suffix}`);
}

/**
 * Get venue reviews from Yelp
 */
export async function getVenueTips(
  yelpId: string,
  limit: number = 3
): Promise<Array<{ text: string; createdAt: string }>> {
  if (!YELP_API_KEY) {
    return [];
  }

  try {
    const response = await fetch(
      `https://api.yelp.com/v3/businesses/${yelpId}/reviews?limit=${limit}`,
      {
        headers: {
          Authorization: `Bearer ${YELP_API_KEY}`,
          Accept: 'application/json',
        },
      }
    );

    if (!response.ok) return [];

    const data = await response.json();
    return (data.reviews || []).map((r: any) => ({
      text: r.text,
      createdAt: r.time_created,
    }));
  } catch {
    return [];
  }
}

/**
 * Helper: Build photo URL
 */
export function buildPhotoUrl(
  prefix: string,
  suffix: string,
  size: string = '300x200'
): string {
  return `${prefix}${suffix}`;
}

/**
 * Helper: Get price level as string
 */
export function getPriceLevel(price?: number): string {
  if (!price) return '';
  return '$'.repeat(price);
}

/**
 * Category constants (kept for compatibility)
 */
export const WORKSPACE_CATEGORIES = {
  CAFE: 'cafes',
  COFFEE_SHOP: 'coffee',
  COWORKING: 'coworkingspaces',
  LIBRARY: 'libraries',
  ALL: 'cafes,coffee,coworkingspaces,libraries',
};
