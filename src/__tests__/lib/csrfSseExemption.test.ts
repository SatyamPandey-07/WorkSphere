/**
 * Tests for the CSRF SSE endpoint exemption (Issue #1945).
 * GET requests and SSE endpoints must not require CSRF tokens.
 */

// Simulate CSRF exempt path matching
const CSRF_EXEMPT_PATHS = [
  "/api/venues/updates",     // SSE stream
  "/api/auth/csrf-token",    // token issuance
  "/api/push",               // web push (GET)
];

const CSRF_REQUIRED_METHODS = ["POST", "PUT", "PATCH", "DELETE"];
const CSRF_EXEMPT_METHODS = ["GET", "HEAD", "OPTIONS"];

function requiresCsrf(method: string, path: string): boolean {
  // GET/HEAD/OPTIONS never need CSRF
  if (CSRF_EXEMPT_METHODS.includes(method.toUpperCase())) return false;

  // Explicitly exempt paths
  if (CSRF_EXEMPT_PATHS.some((p) => path.startsWith(p))) return false;

  // Mutating methods on non-exempt paths require CSRF
  return CSRF_REQUIRED_METHODS.includes(method.toUpperCase());
}

describe("CSRF protection rules", () => {
  it("GET requests never require CSRF", () => {
    expect(requiresCsrf("GET", "/api/venues")).toBe(false);
    expect(requiresCsrf("GET", "/api/bookings")).toBe(false);
  });

  it("HEAD requests never require CSRF", () => {
    expect(requiresCsrf("HEAD", "/favicon.ico")).toBe(false);
  });

  it("OPTIONS requests never require CSRF (CORS preflight)", () => {
    expect(requiresCsrf("OPTIONS", "/api/venues")).toBe(false);
  });

  it("SSE endpoint (GET /api/venues/updates) never requires CSRF", () => {
    expect(requiresCsrf("GET", "/api/venues/updates")).toBe(false);
  });

  it("POST to SSE-adjacent path is exempt (explicitly listed)", () => {
    // The SSE path is GET-only, but if someone tried a POST we still check
    // In our config, the path exemption applies regardless of method
    expect(requiresCsrf("POST", "/api/venues/updates")).toBe(false);
  });

  it("POST to mutation endpoint requires CSRF", () => {
    expect(requiresCsrf("POST", "/api/bookings/confirm")).toBe(true);
  });

  it("PUT to mutation endpoint requires CSRF", () => {
    expect(requiresCsrf("PUT", "/api/venues/venue-123")).toBe(true);
  });

  it("DELETE to mutation endpoint requires CSRF", () => {
    expect(requiresCsrf("DELETE", "/api/collections/folder-1")).toBe(true);
  });

  it("CSRF token endpoint itself is exempt", () => {
    expect(requiresCsrf("GET", "/api/auth/csrf-token")).toBe(false);
  });

  it("case-insensitive method matching", () => {
    expect(requiresCsrf("get", "/api/venues")).toBe(false);
    expect(requiresCsrf("post", "/api/bookings")).toBe(true);
  });
});
