import { NextRequest, NextResponse } from "next/server";
import { getVenuePhotoDetails } from "@/lib/googlePlaces";

/**
 * GET /api/venues/[venueId]/photo?name=...&lat=...&lng=...
 *
 * Resolves a Pexels venue photo and proxies the image bytes back,
 * while exposing photographer and source attribution via headers and JSON metadata.
 * The API key never leaves the server — the browser just sees our URL.
 * Response is edge-cached for 24h so repeat renders cost 0 API calls.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ venueId: string }> },
) {
  const { venueId } = await params;
  const { searchParams } = req.nextUrl;

  const name = searchParams.get("name");
  const lat = parseFloat(searchParams.get("lat") ?? "");
  const lng = parseFloat(searchParams.get("lng") ?? "");

  if (!name || isNaN(lat) || isNaN(lng)) {
    return new Response(null, { status: 400 });
  }

  try {
    const details = await getVenuePhotoDetails(venueId, name, lat, lng);

    if (!details || !details.url) {
      console.warn(`[photo] No photo found for venue "${name}" (${venueId})`);
      return new Response(null, { status: 404 });
    }

    // Return JSON metadata if requested
    if (
      searchParams.get("metadata") === "true" ||
      req.headers.get("accept")?.includes("application/json")
    ) {
      return NextResponse.json({
        venueId,
        name,
        url: `/api/venues/${encodeURIComponent(venueId)}/photo?name=${encodeURIComponent(name)}&lat=${lat}&lng=${lng}`,
        imageUrl: details.url,
        photographer: details.photographer ?? null,
        photographerUrl: details.photographerUrl ?? null,
        photoPageUrl: details.photoPageUrl ?? null,
        source: details.source,
      });
    }

    // Proxy the image — fetch follows redirect to the CDN URL
    const imageRes = await fetch(details.url, { redirect: "follow" });

    if (!imageRes.ok) {
      return new Response(null, { status: 502 });
    }

    const headers = new Headers();
    headers.set(
      "Content-Type",
      imageRes.headers.get("Content-Type") || "image/jpeg",
    );
    headers.set(
      "Cache-Control",
      "public, s-maxage=86400, stale-while-revalidate=3600",
    );
    headers.set("X-Photo-Source", details.source);

    if (details.photographer) {
      headers.set(
        "X-Photo-Photographer",
        encodeURIComponent(details.photographer),
      );
    }
    if (details.photographerUrl) {
      headers.set("X-Photo-Photographer-Url", details.photographerUrl);
    }
    if (details.photoPageUrl) {
      headers.set("X-Photo-Page-Url", details.photoPageUrl);
    }

    headers.set(
      "Access-Control-Expose-Headers",
      "X-Photo-Source, X-Photo-Photographer, X-Photo-Photographer-Url, X-Photo-Page-Url",
    );

    return new Response(imageRes.body, { headers });
  } catch (err) {
    console.error("[/api/venues/photo] Error:", err);
    return new Response(null, { status: 500 });
  }
}
