import { NextRequest, NextResponse } from "next/server";

const DEFAULT_LOCATION = {
  lat: 37.7749,
  lng: -122.4194,
  city: "San Francisco",
  region: "California",
  country: "US",
  source: "default",
};

function isPrivateOrLoopbackIP(ip: string): boolean {
  if (
    !ip ||
    ip === "auto" ||
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "localhost"
  ) {
    return true;
  }
  if (
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    ip.startsWith("127.") ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)
  ) {
    return true;
  }
  return false;
}

async function fetchIPLocation(rawIp: string | null) {
  const forwardedIp = rawIp ? rawIp.split(",")[0].trim() : "";
  const isPrivate = isPrivateOrLoopbackIP(forwardedIp);
  const targetIp = isPrivate ? "" : forwardedIp;

  // Provider 1: ipwho.is (fast, HTTPS, free)
  try {
    const res = await fetch(`https://ipwho.is/${targetIp}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      if (
        data.success &&
        typeof data.latitude === "number" &&
        typeof data.longitude === "number"
      ) {
        return {
          lat: data.latitude,
          lng: data.longitude,
          city: data.city || "San Francisco",
          region: data.region || "California",
          country: data.country_code || "US",
          timezone: data.timezone?.id,
          source: "ipwho.is",
        };
      }
    }
  } catch {}

  // Provider 2: ip-api.com
  try {
    const res = await fetch(`http://ip-api.com/json/${targetIp}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) {
      const data = await res.json();
      if (
        data.status === "success" &&
        typeof data.lat === "number" &&
        typeof data.lon === "number"
      ) {
        return {
          lat: data.lat,
          lng: data.lon,
          city: data.city || "San Francisco",
          region: data.regionName || "California",
          country: data.countryCode || "US",
          timezone: data.timezone,
          source: "ip-api.com",
        };
      }
    }
  } catch {}

  // Provider 3: ipapi.co
  try {
    const res = await fetch(
      `https://ipapi.co/${targetIp ? targetIp + "/" : ""}json/`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(3000),
      },
    );
    if (res.ok) {
      const data = await res.json();
      if (
        !data.error &&
        typeof data.latitude === "number" &&
        typeof data.longitude === "number"
      ) {
        return {
          lat: data.latitude,
          lng: data.longitude,
          city: data.city || "San Francisco",
          region: data.region || "California",
          country: data.country_code || "US",
          timezone: data.timezone,
          source: "ipapi.co",
        };
      }
    }
  } catch {}

  return DEFAULT_LOCATION;
}

// GET /api/location - Multi-provider IP-based location fallback (#1113)
export async function GET(req: NextRequest) {
  try {
    const forwarded = req.headers.get("x-forwarded-for");
    const location = await fetchIPLocation(forwarded);
    return NextResponse.json(location, { status: 200 });
  } catch {
    return NextResponse.json(DEFAULT_LOCATION, { status: 200 });
  }
}
