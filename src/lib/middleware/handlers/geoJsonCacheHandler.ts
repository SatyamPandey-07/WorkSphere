import type { MiddlewareHandler } from "../types";
import { STATIC_GEOJSON_CACHE_CONTROL } from "@/lib/http/etag";

/**
 * Middleware handler for static GeoJSON boundary assets.
 * Ensures boundary assets are served with proper public Cache-Control headers.
 */
export const geoJsonCacheMiddleware: MiddlewareHandler = async (req, ctx, next) => {
  const isBoundaryRoute =
    req.nextUrl.pathname.startsWith("/api/map/boundaries") ||
    req.nextUrl.pathname.endsWith(".geojson");

  if (!isBoundaryRoute) {
    return await next();
  }

  const res = await next();
  res.headers.set("Cache-Control", STATIC_GEOJSON_CACHE_CONTROL);
  return res;
};
