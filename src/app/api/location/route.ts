import { NextRequest } from "next/server";

// GET /api/location - IP-based location fallback
export async function GET(req: NextRequest) {
  try {
    // Try to get location from IP using free ipapi service
    const forwarded = req.headers.get("x-forwarded-for");
    const ip = forwarded ? forwarded.split(",")[0] : "auto";

    const response = await fetch(`https://ipapi.co/${ip === "auto" ? "" : ip + "/"}json/`);

    if (!response.ok) {
      throw new Error("Failed to fetch location from IP");
    }

    const data = await response.json();

    if (data.error) {
      // Fallback to default location (San Francisco)
      return Response.json({
        lat: 37.7749,
        lng: -122.4194,
        city: "San Francisco",
        region: "California",
        country: "US",
        source: "default",
      });
    }

    return Response.json({
      lat: data.latitude,
      lng: data.longitude,
      city: data.city,
      region: data.region,
      country: data.country_code,
      timezone: data.timezone,
      source: "ip-geolocation",
    });
  } catch (error) {
    console.error("Location API error:", error);

    // Return default location on error
    return Response.json({
      lat: 37.7749,
      lng: -122.4194,
      city: "San Francisco",
      region: "California",
      country: "US",
      source: "default",
      error: "Failed to determine location from IP",
    });
  }
}
