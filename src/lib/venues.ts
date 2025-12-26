/**
 * Venue enrichment using FREE APIs (no credit card required)
 * - OpenStreetMap (OSM) Nominatim/Overpass for venue data
 * - Unsplash for photos
 */

const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || process.env.NEXT_PUBLIC_UNSPLASH_ACCESS_KEY;

// =============================================================================
// Types
// =============================================================================

export interface VenueData {
  id: string;
  name: string;
  location: {
    address?: string;
    formatted_address?: string;
    locality?: string;
    region?: string;
    country?: string;
    lat: number;
    lng: number;
  };
  categories: Array<{ name: string }>;
  distance?: number;
  photos: string[];
  amenities?: {
    wifi?: boolean;
    outdoor_seating?: boolean;
    wheelchair?: boolean;
  };
  opening_hours?: string;
  website?: string;
  phone?: string;
}

// =============================================================================
// OpenStreetMap APIs (FREE, no key needed)
// =============================================================================

/**
 * Search for venues using OSM Nominatim
 */
export async function searchVenuesOSM(
  lat: number,
  lng: number,
  options: {
    query?: string;
    radius?: number;
    limit?: number;
  } = {}
): Promise<VenueData[]> {
  const { query, radius = 2000, limit = 20 } = options;

  // Use Overpass API for POI search (cafes, coworking, libraries)
  const overpassQuery = `
    [out:json][timeout:25];
    (
      node["amenity"="cafe"](around:${radius},${lat},${lng});
      node["amenity"="library"](around:${radius},${lat},${lng});
      node["office"="coworking"](around:${radius},${lat},${lng});
      node["amenity"="coworking_space"](around:${radius},${lat},${lng});
      node["amenity"="coffee_shop"](around:${radius},${lat},${lng});
    );
    out body ${limit};
  `;

  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(overpassQuery)}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    if (!response.ok) {
      console.error('Overpass API error:', response.status);
      return [];
    }

    const data = await response.json();
    
    const venues: VenueData[] = (data.elements || [])
      .filter((el: any) => el.tags?.name)
      .map((el: any) => {
        const tags = el.tags || {};
        return {
          id: `osm-${el.id}`,
          name: tags.name,
          location: {
            address: tags['addr:street'] ? `${tags['addr:housenumber'] || ''} ${tags['addr:street']}`.trim() : undefined,
            formatted_address: [
              tags['addr:street'],
              tags['addr:city'],
              tags['addr:postcode'],
            ].filter(Boolean).join(', ') || undefined,
            locality: tags['addr:city'],
            country: tags['addr:country'],
            lat: el.lat,
            lng: el.lon,
          },
          categories: [{ name: getOSMCategory(tags) }],
          distance: calculateDistance(lat, lng, el.lat, el.lon),
          photos: [], // Will be enriched with Unsplash
          amenities: {
            wifi: tags.internet_access === 'wlan' || tags.internet_access === 'yes',
            outdoor_seating: tags.outdoor_seating === 'yes',
            wheelchair: tags.wheelchair === 'yes',
          },
          opening_hours: tags.opening_hours,
          website: tags.website || tags['contact:website'],
          phone: tags.phone || tags['contact:phone'],
        };
      });

    // Filter by query if provided
    if (query) {
      const q = query.toLowerCase();
      return venues.filter(v => 
        v.name.toLowerCase().includes(q) ||
        v.categories.some(c => c.name.toLowerCase().includes(q))
      ).slice(0, limit);
    }

    return venues.slice(0, limit);
  } catch (error) {
    console.error('OSM search error:', error);
    return [];
  }
}

/**
 * Get category name from OSM tags
 */
function getOSMCategory(tags: Record<string, string>): string {
  if (tags.office === 'coworking' || tags.amenity === 'coworking_space') return 'Coworking Space';
  if (tags.amenity === 'library') return 'Library';
  if (tags.amenity === 'cafe' || tags.amenity === 'coffee_shop') return 'Café';
  return 'Workspace';
}

/**
 * Calculate distance between two points in meters
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

// =============================================================================
// Unsplash API (FREE, needs key but no credit card)
// =============================================================================

/**
 * Get photos from Unsplash for a venue category
 * Returns relevant workspace/cafe photos
 */
export async function getVenuePhotos(
  venueName: string,
  category: string = 'cafe',
  count: number = 3
): Promise<string[]> {
  if (!UNSPLASH_ACCESS_KEY) {
    console.warn('Unsplash API key not configured, using fallback');
    return getFallbackPhotos(category);
  }

  // Search terms based on venue type
  const searchTerms: Record<string, string> = {
    'Café': 'coffee shop interior laptop',
    'Coworking Space': 'coworking space modern office',
    'Library': 'library study workspace',
    'Workspace': 'workspace laptop coffee',
  };

  const query = searchTerms[category] || 'cafe workspace laptop';

  try {
    const response = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`,
      {
        headers: {
          Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`,
        },
      }
    );

    if (!response.ok) {
      console.error('Unsplash API error:', response.status);
      return getFallbackPhotos(category);
    }

    const data = await response.json();
    return (data.results || []).map((photo: any) => 
      photo.urls?.regular || photo.urls?.small
    ).filter(Boolean);
  } catch (error) {
    console.error('Unsplash error:', error);
    return getFallbackPhotos(category);
  }
}

/**
 * Fallback photos when Unsplash is not available
 * Using Unsplash Source (no API key needed, random photos)
 */
function getFallbackPhotos(category: string): string[] {
  const queries: Record<string, string> = {
    'Café': 'coffee-shop',
    'Coworking Space': 'office-workspace',
    'Library': 'library',
    'Workspace': 'laptop-cafe',
  };
  
  const query = queries[category] || 'workspace';
  
  // Unsplash Source URLs (free, no API key)
  return [
    `https://source.unsplash.com/800x600/?${query}&sig=1`,
    `https://source.unsplash.com/800x600/?${query}&sig=2`,
    `https://source.unsplash.com/800x600/?${query}&sig=3`,
  ];
}

// =============================================================================
// Combined Venue Enrichment
// =============================================================================

/**
 * Search and enrich venues with photos
 */
export async function searchAndEnrichVenues(
  lat: number,
  lng: number,
  options: {
    query?: string;
    radius?: number;
    limit?: number;
  } = {}
): Promise<VenueData[]> {
  const venues = await searchVenuesOSM(lat, lng, options);
  
  // Enrich each venue with photos (in parallel, max 5 at a time)
  const enrichedVenues = await Promise.all(
    venues.slice(0, 5).map(async (venue) => {
      const categoryName = venue.categories[0]?.name || 'Workspace';
      const photos = await getVenuePhotos(venue.name, categoryName, 3);
      return { ...venue, photos };
    })
  );

  // Return enriched + non-enriched venues
  return [
    ...enrichedVenues,
    ...venues.slice(5).map(v => ({ ...v, photos: getFallbackPhotos(v.categories[0]?.name || 'Workspace') })),
  ];
}

/**
 * Get venue details by OSM ID
 */
export async function getVenueDetails(osmId: string): Promise<VenueData | null> {
  // Extract numeric ID from 'osm-123456' format
  const numericId = osmId.replace('osm-', '');
  
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/lookup?osm_ids=N${numericId}&format=json&addressdetails=1&extratags=1`,
      {
        headers: {
          'User-Agent': 'WorkSphere/1.0',
        },
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    if (!data.length) return null;

    const place = data[0];
    const category = place.type === 'library' ? 'Library' : 
                     place.type === 'cafe' ? 'Café' : 'Workspace';
    
    const photos = await getVenuePhotos(place.display_name, category, 5);

    return {
      id: osmId,
      name: place.display_name?.split(',')[0] || place.name,
      location: {
        formatted_address: place.display_name,
        locality: place.address?.city || place.address?.town,
        region: place.address?.state,
        country: place.address?.country,
        lat: parseFloat(place.lat),
        lng: parseFloat(place.lon),
      },
      categories: [{ name: category }],
      photos,
      amenities: {
        wifi: place.extratags?.internet_access === 'wlan',
        outdoor_seating: place.extratags?.outdoor_seating === 'yes',
      },
      opening_hours: place.extratags?.opening_hours,
      website: place.extratags?.website,
      phone: place.extratags?.phone,
    };
  } catch (error) {
    console.error('OSM details error:', error);
    return null;
  }
}

// =============================================================================
// Backward Compatibility (for existing code using foursquare.ts interface)
// =============================================================================

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
  rating?: number;
  price?: number;
  hours?: {
    display?: string;
    open_now?: boolean;
  };
  photos?: Array<{
    id: string;
    prefix: string;
    suffix: string;
  }>;
  tel?: string;
  website?: string;
}

/**
 * Convert VenueData to FoursquareVenue format for compatibility
 */
export function toFoursquareFormat(venue: VenueData): FoursquareVenue {
  return {
    fsq_id: venue.id,
    name: venue.name,
    location: venue.location,
    categories: venue.categories.map((c, i) => ({
      id: i,
      name: c.name,
      icon: { prefix: '', suffix: '' },
    })),
    distance: venue.distance,
    rating: undefined, // OSM doesn't have ratings
    price: undefined,
    hours: venue.opening_hours ? {
      display: venue.opening_hours,
      open_now: undefined,
    } : undefined,
    photos: venue.photos.map((url, i) => ({
      id: i.toString(),
      prefix: url,
      suffix: '',
    })),
    tel: venue.phone,
    website: venue.website,
  };
}

export const WORKSPACE_CATEGORIES = {
  CAFE: 'cafe',
  COFFEE_SHOP: 'coffee',
  COWORKING: 'coworking',
  LIBRARY: 'library',
  ALL: 'cafe,coworking,library',
};
