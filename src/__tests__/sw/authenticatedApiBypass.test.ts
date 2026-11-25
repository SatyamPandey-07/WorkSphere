import fs from "fs";
import path from "path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const swModule = require("../../../public/sw.js");

const {
  STATIC_CACHE_NAME,
  RUNTIME_PUBLIC_CACHE_NAME,
  PUBLIC_CACHEABLE_API_PREFIXES,
  isAuthenticatedOrPrivateRequest,
  isCacheablePublicResponse,
  purgeDynamicRuntimeCaches,
} = swModule;

describe("Service Worker Authenticated API Caching Bypass (#9809)", () => {
  describe("isAuthenticatedOrPrivateRequest", () => {
    it("bypasses non-GET HTTP methods from CacheStorage", () => {
      const postReq = new Request("http://localhost:3000/api/venues/public", {
        method: "POST",
      });
      const url = new URL(postReq.url);
      expect(isAuthenticatedOrPrivateRequest(postReq, url)).toBe(true);

      const putReq = new Request("http://localhost:3000/api/venues/public", {
        method: "PUT",
      });
      expect(isAuthenticatedOrPrivateRequest(putReq, new URL(putReq.url))).toBe(
        true,
      );

      const deleteReq = new Request("http://localhost:3000/api/venues/public", {
        method: "DELETE",
      });
      expect(
        isAuthenticatedOrPrivateRequest(deleteReq, new URL(deleteReq.url)),
      ).toBe(true);
    });

    it("bypasses protected and user-specific /api routes from CacheStorage", () => {
      const protectedEndpoints = [
        "http://localhost:3000/api/venues/managed",
        "http://localhost:3000/api/venues/venue_123/waitlist",
        "http://localhost:3000/api/user/notifications",
        "http://localhost:3000/api/bookings/export",
        "http://localhost:3000/api/folders/folder_1/export-billing",
        "http://localhost:3000/api/auth/magic-link",
      ];

      for (const endpoint of protectedEndpoints) {
        const req = new Request(endpoint, { method: "GET" });
        const url = new URL(req.url);
        expect(isAuthenticatedOrPrivateRequest(req, url)).toBe(true);
      }
    });

    it("permits unauthenticated allowlisted public API routes without credentials", () => {
      const publicEndpoints = [
        "http://localhost:3000/api/venues/public",
        "http://localhost:3000/api/venues/public/filter",
        "http://localhost:3000/api/health",
      ];

      for (const endpoint of publicEndpoints) {
        const req = new Request(endpoint, { method: "GET" });
        const url = new URL(req.url);
        expect(isAuthenticatedOrPrivateRequest(req, url)).toBe(false);
      }
    });

    it("bypasses allowlisted public API routes when Authorization header is present", () => {
      const req = new Request("http://localhost:3000/api/venues/public", {
        method: "GET",
        headers: { Authorization: "Bearer session_token_123" },
      });
      const url = new URL(req.url);
      expect(isAuthenticatedOrPrivateRequest(req, url)).toBe(true);
    });

    it("bypasses allowlisted public API routes when Cookie header is present", () => {
      const req = new Request("http://localhost:3000/api/venues/public", {
        method: "GET",
        headers: { Cookie: "__session=clerk_jwt_cookie_val" },
      });
      const url = new URL(req.url);
      expect(isAuthenticatedOrPrivateRequest(req, url)).toBe(true);
    });

    it("bypasses requests with Cache-Control: no-store or private", () => {
      const noStoreReq = new Request("http://localhost:3000/manifest.json", {
        method: "GET",
        headers: { "Cache-Control": "no-store" },
      });
      expect(
        isAuthenticatedOrPrivateRequest(noStoreReq, new URL(noStoreReq.url)),
      ).toBe(true);

      const privateReq = new Request("http://localhost:3000/manifest.json", {
        method: "GET",
        headers: { "Cache-Control": "private, max-age=0" },
      });
      expect(
        isAuthenticatedOrPrivateRequest(privateReq, new URL(privateReq.url)),
      ).toBe(true);
    });

    it("allows non-API static public resources to be handled by cache", () => {
      const req = new Request("http://localhost:3000/manifest.json", {
        method: "GET",
      });
      const url = new URL(req.url);
      expect(isAuthenticatedOrPrivateRequest(req, url)).toBe(false);
    });
  });

  describe("isCacheablePublicResponse", () => {
    it("approves 200 OK responses with standard public cache directives", () => {
      const response = new Response(JSON.stringify({ status: "healthy" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=3600",
        },
      });

      expect(isCacheablePublicResponse(response)).toBe(true);
    });

    it("rejects non-200 HTTP status codes", () => {
      const statuses = [400, 401, 403, 404, 500, 503];
      for (const status of statuses) {
        const response = new Response("Error", { status });
        expect(isCacheablePublicResponse(response)).toBe(false);
      }
    });

    it("rejects opaque cross-origin responses", () => {
      const opaqueResponse = {
        ok: true,
        status: 200,
        type: "opaque",
        headers: new Headers(),
      };
      expect(isCacheablePublicResponse(opaqueResponse as any)).toBe(false);
    });

    it("rejects responses containing no-store, private, or no-cache in Cache-Control", () => {
      const forbiddenDirectives = [
        "no-store",
        "private, max-age=0",
        "no-cache, must-revalidate",
      ];

      for (const directive of forbiddenDirectives) {
        const response = new Response(JSON.stringify({ data: "private" }), {
          status: 200,
          headers: { "Cache-Control": directive },
        });
        expect(isCacheablePublicResponse(response)).toBe(false);
      }
    });

    it("rejects responses with Vary: Cookie or Vary: Authorization", () => {
      const varyCookieResponse = new Response("{}", {
        status: 200,
        headers: { Vary: "Cookie, Accept-Encoding" },
      });
      expect(isCacheablePublicResponse(varyCookieResponse)).toBe(false);

      const varyAuthResponse = new Response("{}", {
        status: 200,
        headers: { Vary: "Authorization" },
      });
      expect(isCacheablePublicResponse(varyAuthResponse)).toBe(false);
    });
  });

  describe("purgeDynamicRuntimeCaches", () => {
    it("deletes all runtime dynamic caches and retains only STATIC_CACHE_NAME", async () => {
      const mockDelete = jest.fn().mockResolvedValue(true);
      const mockKeys = jest
        .fn()
        .mockResolvedValue([
          STATIC_CACHE_NAME,
          RUNTIME_PUBLIC_CACHE_NAME,
          "worksphere-v3",
          "worksphere-maptiles-v1",
        ]);

      (global as any).caches = {
        keys: mockKeys,
        delete: mockDelete,
      };

      await purgeDynamicRuntimeCaches();

      expect(mockDelete).toHaveBeenCalledWith(RUNTIME_PUBLIC_CACHE_NAME);
      expect(mockDelete).toHaveBeenCalledWith("worksphere-v3");
      expect(mockDelete).toHaveBeenCalledWith("worksphere-maptiles-v1");
      expect(mockDelete).not.toHaveBeenCalledWith(STATIC_CACHE_NAME);
    });
  });

  describe("Single Coordinated Fetch Listener Invariant", () => {
    it("registers exactly one fetch event listener in public/sw.js", () => {
      const swPath = path.resolve(process.cwd(), "public/sw.js");
      const swContent = fs.readFileSync(swPath, "utf-8");

      const fetchListenerMatches = swContent.match(
        /addEventListener\(\s*["']fetch["']/g,
      );
      expect(fetchListenerMatches).not.toBeNull();
      expect(fetchListenerMatches?.length).toBe(1);
    });

    it("exports required public cache identifiers and prefix constants", () => {
      expect(STATIC_CACHE_NAME).toBeDefined();
      expect(RUNTIME_PUBLIC_CACHE_NAME).toBeDefined();
      expect(PUBLIC_CACHEABLE_API_PREFIXES).toContain("/api/venues/public");
      expect(PUBLIC_CACHEABLE_API_PREFIXES).toContain("/api/health");
    });
  });
});
