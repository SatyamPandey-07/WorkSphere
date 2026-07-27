import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/rateLimit";

const DEFAULT_LOCATION = {
  lat: 37.7749,
  lng: -122.4194,
  city: "San Francisco",
  region: "California",
  country: "US",
  source: "default",
};

import { LocationResult, locationCache } from "@/lib/locationCache";

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

async function fetchIPLocation(rawIp: string | null): Promise<LocationResult> {
  const forwardedIp = rawIp ? rawIp.split(",")[0].trim() : "";
  const isPrivate = isPrivateOrLoopbackIP(forwardedIp);
  const targetIp = isPrivate ? "" : forwardedIp;

  // Provider 1: ipwho.is (fast, HTTPS, free)
  try {
    const res = await fetch(`https://ipwho.is/${targetIp}`, {
      headers: { Accept: "application/json" },
      signal:
        typeof AbortSignal.timeout === "function"
          ? AbortSignal.timeout(3000)
          : undefined,
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

  // Provider 2: ip-api.com (HTTPS)
  try {
    const res = await fetch(`https://ip-api.com/json/${targetIp}`, {
      headers: { Accept: "application/json" },
      signal:
        typeof AbortSignal.timeout === "function"
          ? AbortSignal.timeout(3000)
          : undefined,
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
        signal:
          typeof AbortSignal.timeout === "function"
            ? AbortSignal.timeout(3000)
            : undefined,
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

// GET /api/location - Multi-provider IP-based location fallback (#1113, #1655)
export async function GET(req: NextRequest) {
  try {
    const forwarded = req.headers.get("x-forwarded-for");
    const realIp = req.headers.get("x-real-ip");
    const forwardedIp = forwarded
      ? forwarded.split(",")[0].trim()
      : realIp || "";
    const ip = forwardedIp || "127.0.0.1";

    // Rate limiting: 10 requests per minute per IP
    const identifier = `location:${ip}`;
    const allowed = await rateLimit(identifier, 10);
    if (!allowed) {
      // Graceful degradation on rate limit
      return NextResponse.json(DEFAULT_LOCATION, { status: 200 });
    }

    // In-memory cache lookup (10-minute TTL)
    const cached = locationCache.get(ip);
    if (cached) {
      return NextResponse.json(cached, { status: 200 });
    }

    const location = await fetchIPLocation(forwarded);
    locationCache.set(ip, location);
    return NextResponse.json(location, { status: 200 });
  } catch {
    return NextResponse.json(DEFAULT_LOCATION, { status: 200 });
  }
}
