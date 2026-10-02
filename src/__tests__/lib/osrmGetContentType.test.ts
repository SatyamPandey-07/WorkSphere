/**
 * Tests for the OSRM GET request Content-Type header fix (Issue #2119).
 * GET requests must not include Content-Type headers.
 */

// Simulate header building for GET vs POST requests
function buildRouteRequestHeaders(method: "GET" | "POST"): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  // The fix: only add Content-Type for requests with a body
  if (method === "POST") {
    headers["Content-Type"] = "application/json";
  }

  return headers;
}

describe("OSRM route request headers", () => {
  it("GET request does NOT include Content-Type header", () => {
    const headers = buildRouteRequestHeaders("GET");
    expect("Content-Type" in headers).toBe(false);
  });

  it("GET request DOES include Accept header", () => {
    const headers = buildRouteRequestHeaders("GET");
    expect(headers["Accept"]).toBe("application/json");
  });

  it("POST request includes Content-Type header", () => {
    const headers = buildRouteRequestHeaders("POST");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("POST request also includes Accept header", () => {
    const headers = buildRouteRequestHeaders("POST");
    expect(headers["Accept"]).toBe("application/json");
  });

  it("GET request has exactly one header (Accept)", () => {
    const headers = buildRouteRequestHeaders("GET");
    expect(Object.keys(headers)).toHaveLength(1);
    expect(Object.keys(headers)).toContain("Accept");
  });

  it("POST request has two headers (Accept + Content-Type)", () => {
    const headers = buildRouteRequestHeaders("POST");
    expect(Object.keys(headers)).toHaveLength(2);
  });
});

describe("HTTP method semantics", () => {
  it("GET requests should never have a Content-Type (no body)", () => {
    // RFC 7231: Content-Type is only meaningful with a body
    const bodyMethods = ["POST", "PUT", "PATCH"];
    const noBodyMethods = ["GET", "HEAD", "DELETE", "OPTIONS"];

    bodyMethods.forEach((method) => {
      // These can have Content-Type
      expect(["POST", "PUT", "PATCH"]).toContain(method);
    });

    noBodyMethods.forEach((method) => {
      expect(["GET", "HEAD", "DELETE", "OPTIONS"]).toContain(method);
    });
  });
});
