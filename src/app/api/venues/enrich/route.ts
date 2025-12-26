import { NextRequest, NextResponse } from "next/server";
import { 
  searchAndEnrichVenues, 
  getVenueDetails,
} from "@/lib/venues";

/**
 * GET /api/venues/enrich - Enrich venue with OSM + Unsplash data (FREE, no card)
 * Query params: 
 *   - name: venue name to search
 *   - lat, lng: coordinates to find nearby match
 *   - venueId: direct OSM ID (if known)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get("name");
    const lat = searchParams.get("lat");
    const lng = searchParams.get("lng");
    const venueId = searchParams.get("venueId") || searchParams.get("fsqId");

    // If we have venue ID, get details directly
    if (venueId) {
      const details = await getVenueDetails(venueId);

      if (!details) {
        return NextResponse.json({ error: "Venue not found" }, { status: 404 });
      }

      return NextResponse.json({
        venueId: details.id,
        fsqId: details.id, // Backward compat
        name: details.name,
        photos: details.photos,
        website: details.website,
        phone: details.phone,
        address: details.location?.formatted_address,
        amenities: details.amenities,
        opening_hours: details.opening_hours,
        categories: details.categories.map(c => c.name),
      });
    }

    // Otherwise search by name and location
    if (!name || !lat || !lng) {
      return NextResponse.json(
        { error: "name, lat, and lng are required" },
        { status: 400 }
      );
    }

    // Search for matching venue using OSM + Unsplash
    console.log('[Enrich] Searching for:', { name, lat, lng });
    const venues = await searchAndEnrichVenues(parseFloat(lat), parseFloat(lng), {
      query: name === 'cafe' ? undefined : name, // Don't filter by 'cafe' since we already search cafes
      radius: 2000, // 2km radius
      limit: 10,
    });
    console.log('[Enrich] Found venues:', venues.length);

    if (venues.length === 0) {
      console.log('[Enrich] No venues found, returning fallback');
      // Return fallback photos even if no venue found
      const fallbackPhotos = [
        `https://source.unsplash.com/800x600/?cafe-workspace&sig=${Date.now()}`,
        `https://source.unsplash.com/800x600/?coffee-laptop&sig=${Date.now() + 1}`,
      ];
      return NextResponse.json({ 
        found: false,
        photos: fallbackPhotos, // Still provide photos for UI
      });
    }

    // Find best match by name similarity
    const bestMatch = venues.find((v) =>
      v.name.toLowerCase().includes(name.toLowerCase()) ||
      name.toLowerCase().includes(v.name.toLowerCase())
    ) || venues[0];

    return NextResponse.json({
      found: true,
      venueId: bestMatch.id,
      fsqId: bestMatch.id, // Backward compat
      name: bestMatch.name,
      distance: bestMatch.distance,
      address: bestMatch.location?.formatted_address,
      categories: bestMatch.categories?.map((c) => c.name),
      photos: bestMatch.photos,
      amenities: bestMatch.amenities,
      opening_hours: bestMatch.opening_hours,
      website: bestMatch.website,
      phone: bestMatch.phone,
    });
  } catch (error) {
    console.error("Venue enrich error:", error);
    return NextResponse.json(
      { error: "Failed to enrich venue" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/venues/enrich - Bulk enrich multiple venues
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { venues } = body;

    if (!venues || !Array.isArray(venues)) {
      return NextResponse.json(
        { error: "venues array is required" },
        { status: 400 }
      );
    }

    // Enrich up to 10 venues at a time
    const enrichedVenues = await Promise.all(
      venues.slice(0, 10).map(async (venue: { name: string; lat: number; lng: number }) => {
        const results = await searchAndEnrichVenues(venue.lat, venue.lng, {
          query: venue.name,
          radius: 300,
          limit: 1,
        });

        if (results.length === 0) {
          // Still return fallback photos
          return { 
            ...venue, 
            enriched: false,
            photos: [
              `https://source.unsplash.com/800x600/?workspace&sig=${Date.now()}`,
            ],
          };
        }

        const match = results[0];
        return {
          ...venue,
          enriched: true,
          venueId: match.id,
          fsqId: match.id,
          photos: match.photos,
          amenities: match.amenities,
          opening_hours: match.opening_hours,
        };
      })
    );

    return NextResponse.json({ venues: enrichedVenues });
  } catch (error) {
    console.error("Bulk enrich error:", error);
    return NextResponse.json(
      { error: "Failed to bulk enrich venues" },
      { status: 500 }
    );
  }
}
