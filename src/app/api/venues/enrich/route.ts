import { NextRequest, NextResponse } from "next/server";
import { getVenueDetails, getVenuePhotos, getVenueTips, searchVenues, WORKSPACE_CATEGORIES } from "@/lib/foursquare";

/**
 * GET /api/venues/enrich - Enrich venue with Foursquare data
 * Query params: 
 *   - name: venue name to search
 *   - lat, lng: coordinates to find nearby match
 *   - fsqId: direct Foursquare ID (if known)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const name = searchParams.get("name");
    const lat = searchParams.get("lat");
    const lng = searchParams.get("lng");
    const fsqId = searchParams.get("fsqId");

    // If we have Foursquare ID, get details directly
    if (fsqId) {
      const [details, photos, tips] = await Promise.all([
        getVenueDetails(fsqId),
        getVenuePhotos(fsqId, 5),
        getVenueTips(fsqId, 3),
      ]);

      if (!details) {
        return NextResponse.json({ error: "Venue not found" }, { status: 404 });
      }

      return NextResponse.json({
        fsqId: details.fsq_id,
        name: details.name,
        rating: details.rating,
        price: details.price,
        hours: details.hours,
        photos,
        tips,
        website: details.website,
        phone: details.tel,
        features: details.features,
        address: details.location?.formatted_address,
      });
    }

    // Otherwise search by name and location
    if (!name || !lat || !lng) {
      return NextResponse.json(
        { error: "name, lat, and lng are required" },
        { status: 400 }
      );
    }

    // Search for matching venue
    const venues = await searchVenues(parseFloat(lat), parseFloat(lng), {
      query: name,
      categories: WORKSPACE_CATEGORIES.ALL,
      radius: 500, // Small radius for precise match
      limit: 5,
    });

    if (venues.length === 0) {
      return NextResponse.json({ found: false });
    }

    // Find best match by name similarity
    const bestMatch = venues.find((v) =>
      v.name.toLowerCase().includes(name.toLowerCase()) ||
      name.toLowerCase().includes(v.name.toLowerCase())
    ) || venues[0];

    // Get additional details
    const [photos, tips] = await Promise.all([
      getVenuePhotos(bestMatch.fsq_id, 5),
      getVenueTips(bestMatch.fsq_id, 3),
    ]);

    return NextResponse.json({
      found: true,
      fsqId: bestMatch.fsq_id,
      name: bestMatch.name,
      rating: bestMatch.rating,
      price: bestMatch.price,
      distance: bestMatch.distance,
      address: bestMatch.location?.formatted_address,
      categories: bestMatch.categories?.map((c) => c.name),
      photos,
      tips,
      hours: bestMatch.hours,
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
        const results = await searchVenues(venue.lat, venue.lng, {
          query: venue.name,
          categories: WORKSPACE_CATEGORIES.ALL,
          radius: 300,
          limit: 1,
        });

        if (results.length === 0) {
          return { ...venue, enriched: false };
        }

        const match = results[0];
        const photos = await getVenuePhotos(match.fsq_id, 3);

        return {
          ...venue,
          enriched: true,
          fsqId: match.fsq_id,
          rating: match.rating,
          price: match.price,
          photos,
          hours: match.hours,
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
