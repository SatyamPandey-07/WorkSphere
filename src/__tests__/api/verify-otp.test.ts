import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/auth/verify-otp/route";

describe("POST /api/auth/verify-otp (Retired)", () => {
  function makeRequest(body?: unknown, method = "POST") {
    return new NextRequest("http://localhost/api/auth/verify-otp", {
      method,
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  it("should return HTTP 410 Gone with ENDPOINT_RETIRED code on POST", async () => {
    const req = makeRequest({ email: "test@example.com", otp: "123456" });
    const res = await POST(req);

    expect(res.status).toBe(410);
    const data = await res.json();
    expect(data.code).toBe("ENDPOINT_RETIRED");
    expect(data.error).toMatch(
      /legacy otp verification endpoint has been retired/i,
    );
    expect(data.error).toMatch(/clerk/i);
  });

  it("should return HTTP 410 Gone regardless of submitted payload content", async () => {
    const payloads = [
      {},
      { email: "invalid-email", otp: "abc" },
      { email: "admin@worksphere.com", otp: "999999" },
      null,
    ];

    for (const payload of payloads) {
      const req = makeRequest(payload);
      const res = await POST(req);
      expect(res.status).toBe(410);
      const data = await res.json();
      expect(data.code).toBe("ENDPOINT_RETIRED");
    }
  });

  it("should never return HTTP 200 or successful verification response", async () => {
    const req = makeRequest({ email: "nomad@worksphere.io", otp: "123456" });
    const res = await POST(req);
    expect(res.status).not.toBe(200);
    const data = await res.json();
    expect(data.message).toBeUndefined();
  });

  it("should return HTTP 410 Gone on GET requests", async () => {
    const req = makeRequest(undefined, "GET");
    const res = await GET(req);

    expect(res.status).toBe(410);
    const data = await res.json();
    expect(data.code).toBe("ENDPOINT_RETIRED");
  });
});
