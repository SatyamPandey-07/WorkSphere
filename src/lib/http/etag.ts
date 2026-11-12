import { createHash } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { MiddlewareHandler } from "@/lib/middleware/types";

/**
 * Standard HTTP Cache-Control header directive for static geospatial boundary assets.
 * Instructs browser and edge CDN layers to aggressively cache immutable boundary shapes
 * while allowing background revalidation after 1 day.
 */
export const STATIC_GEOJSON_CACHE_CONTROL =
  "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400";

/**
 * IANA Media Type for RFC 7946 GeoJSON documents.
 */
export const GEOJSON_CONTENT_TYPE = "application/geo+json; charset=utf-8";

export type ETagAlgorithm = "sha256" | "md5";

export interface ETagOptions {
  /**
   * Cryptographic digest algorithm used to hash entity content.
   * Defaults to "sha256".
   */
  algorithm?: ETagAlgorithm;
  /**
   * Whether to format as a weak ETag validator (prefixed with W/).
   * Defaults to false (strong validator).
   */
  weak?: boolean;
}

export interface GeoJsonCacheOptions extends ETagOptions {
  /**
   * Custom Cache-Control directive override.
   * Defaults to STATIC_GEOJSON_CACHE_CONTROL.
   */
  cacheControl?: string;
  /**
   * Custom Content-Type header override.
   * Defaults to GEOJSON_CONTENT_TYPE.
   */
  contentType?: string;
}

/**
 * Generates an HTTP ETag validator string based on the response body content
 * using SHA-256 or MD5.
 *
 * @param body String, Buffer, Uint8Array, or serializable JSON object/array.
 * @param options Algorithm ("sha256" | "md5") and weak flag.
 * @returns Formatted ETag string (e.g., '"6b86b273..."' or 'W/"6b86b273..."').
 */
export function generateETag(
  body: string | Buffer | Uint8Array | Record<string, unknown> | unknown[],
  options?: ETagOptions,
): string {
  const algorithm = options?.algorithm ?? "sha256";
  const weak = options?.weak ?? false;

  let buffer: Buffer;
  if (Buffer.isBuffer(body)) {
    buffer = body;
  } else if (body instanceof Uint8Array) {
    buffer = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  } else if (typeof body === "string") {
    buffer = Buffer.from(body, "utf8");
  } else {
    buffer = Buffer.from(JSON.stringify(body ?? null), "utf8");
  }

  const hash = createHash(algorithm).update(buffer).digest("hex");
  return weak ? `W/"${hash}"` : `"${hash}"`;
}

/**
 * Normalizes an ETag by removing leading/trailing whitespace, weak indicator (W/),
 * and surrounding quotation marks.
 */
export function normalizeETag(etag: string): string {
  return etag.trim().replace(/^W\//i, "").replace(/^"|"$/g, "");
}

/**
 * Evaluates whether an incoming HTTP If-None-Match header satisfies the current ETag.
 * Per RFC 7232 § 3.2, conditional GET/HEAD evaluation MUST employ weak comparison.
 *
 * @param ifNoneMatchHeader Value of the If-None-Match request header.
 * @param currentETag The active ETag calculated from the current entity body.
 * @returns boolean indicating if the entity matches (cache hit).
 */
export function isETagMatch(
  ifNoneMatchHeader: string | null | undefined,
  currentETag: string,
): boolean {
  if (!ifNoneMatchHeader) {
    return false;
  }

  const trimmed = ifNoneMatchHeader.trim();
  if (trimmed === "*") {
    return true;
  }

  const normalizedCurrent = normalizeETag(currentETag);
  const clientTags = trimmed.split(",").map((tag) => normalizeETag(tag));

  return clientTags.includes(normalizedCurrent);
}

/**
 * Constructs an immediate HTTP 304 Not Modified response with an empty body,
 * preserving ETag, Cache-Control, and Vary headers.
 *
 * @param etag The entity tag string.
 * @param cacheControl Cache-Control header string.
 * @param additionalHeaders Optional additional headers to merge.
 */
export function create304Response(
  etag: string,
  cacheControl: string = STATIC_GEOJSON_CACHE_CONTROL,
  additionalHeaders?: HeadersInit,
): NextResponse {
  const headers = new Headers(additionalHeaders);
  headers.set("Cache-Control", cacheControl);
  headers.set("ETag", etag);
  headers.set("Vary", "Accept-Encoding");

  return new NextResponse(null, {
    status: 304,
    statusText: "Not Modified",
    headers,
  });
}

/**
 * Constructs an HTTP 200 OK response with the GeoJSON content, ETag,
 * Cache-Control, and Vary headers.
 */
export function createGeoJsonResponse(
  data: unknown,
  etag: string,
  cacheControl: string = STATIC_GEOJSON_CACHE_CONTROL,
  additionalHeaders?: HeadersInit,
): NextResponse {
  const bodyText = typeof data === "string" ? data : JSON.stringify(data);
  const headers = new Headers(additionalHeaders);
  headers.set("Content-Type", GEOJSON_CONTENT_TYPE);
  headers.set("Cache-Control", cacheControl);
  headers.set("ETag", etag);
  headers.set("Vary", "Accept-Encoding");

  return new NextResponse(bodyText, {
    status: 200,
    headers,
  });
}

/**
 * Handles conditional GET validation for a given request and payload.
 * If If-None-Match matches the generated ETag, returns 304 Not Modified immediately.
 * Otherwise returns a 200 response with appropriate cache and ETag headers.
 */
export function handleConditionalGet(
  request: Request | NextRequest,
  data: unknown,
  options?: GeoJsonCacheOptions,
): NextResponse {
  const algorithm = options?.algorithm ?? "sha256";
  const weak = options?.weak ?? false;
  const cacheControl = options?.cacheControl ?? STATIC_GEOJSON_CACHE_CONTROL;
  const etag = generateETag(data as any, { algorithm, weak });

  const ifNoneMatch = request.headers.get("if-none-match");
  if (isETagMatch(ifNoneMatch, etag)) {
    return create304Response(etag, cacheControl);
  }

  if (request.method === "HEAD") {
    const headHeaders = new Headers();
    headHeaders.set("Content-Type", options?.contentType ?? GEOJSON_CONTENT_TYPE);
    headHeaders.set("Cache-Control", cacheControl);
    headHeaders.set("ETag", etag);
    headHeaders.set("Vary", "Accept-Encoding");
    return new NextResponse(null, { status: 200, headers: headHeaders });
  }

  return createGeoJsonResponse(data, etag, cacheControl);
}

export type RouteHandler = (
  req: NextRequest,
  context?: any,
) => Promise<NextResponse | Response> | NextResponse | Response;

/**
 * Higher-order Route Handler middleware wrapper that transparently enforces:
 * - Cache-Control: public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400
 * - MD5 / SHA-256 ETag generation based on response body content
 * - Instant 304 Not Modified response with empty body when client sends a matching If-None-Match
 */
export function withGeoJsonCache(
  handler: RouteHandler,
  options?: GeoJsonCacheOptions,
): (req: NextRequest, context?: any) => Promise<NextResponse> {
  const algorithm = options?.algorithm ?? "sha256";
  const weak = options?.weak ?? false;
  const cacheControl = options?.cacheControl ?? STATIC_GEOJSON_CACHE_CONTROL;

  return async (req: NextRequest, context?: any): Promise<NextResponse> => {
    // Execute inner handler
    const rawResponse = await handler(req, context);

    // If inner handler already handled 304, preserve it
    if (rawResponse.status === 304) {
      const headers = new Headers(rawResponse.headers);
      if (!headers.has("Cache-Control")) headers.set("Cache-Control", cacheControl);
      return new NextResponse(null, { status: 304, headers });
    }

    // Read response body content
    let bodyText = "";
    if (typeof (rawResponse as any).clone === "function") {
      bodyText = await (rawResponse as Response).clone().text();
    }

    // Generate ETag based on response body content
    const etag = generateETag(bodyText, { algorithm, weak });

    // Evaluate If-None-Match condition
    const ifNoneMatch = req.headers.get("if-none-match");
    if (isETagMatch(ifNoneMatch, etag)) {
      return create304Response(etag, cacheControl);
    }

    // If client requested HEAD, return empty body with headers
    if (req.method === "HEAD") {
      const headHeaders = new Headers(rawResponse.headers);
      headHeaders.set("Cache-Control", cacheControl);
      headHeaders.set("ETag", etag);
      if (!headHeaders.has("Content-Type")) {
        headHeaders.set("Content-Type", options?.contentType ?? GEOJSON_CONTENT_TYPE);
      }
      headHeaders.set("Vary", "Accept-Encoding");
      return new NextResponse(null, { status: 200, headers: headHeaders });
    }

    // Append caching headers to successful response
    const headers = new Headers(rawResponse.headers);
    headers.set("Cache-Control", cacheControl);
    headers.set("ETag", etag);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", options?.contentType ?? GEOJSON_CONTENT_TYPE);
    }
    if (!headers.has("Vary")) {
      headers.set("Vary", "Accept-Encoding");
    }

    return new NextResponse(bodyText, {
      status: rawResponse.status,
      statusText: rawResponse.statusText,
      headers,
    });
  };
}

/**
 * Next.js Edge Middleware handler for static geoJSON boundary assets.
 * Automatically injects Cache-Control headers on boundary routes.
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
