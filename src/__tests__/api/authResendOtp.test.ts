import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/auth/resend-otp/route";

describe("POST /api/auth/resend-otp (Retired)", () => {
  it("should return HTTP 410 Gone with ENDPOINT_RETIRED code on POST", async () => {
    const req = new NextRequest("http://localhost/api/auth/resend-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@example.com" }),
    });

    const res = await POST(req);
    expect(res.status).toBe(410);

    const body = await res.json();
    expect(body).toEqual({
      error:
        "This endpoint has been retired. WorkSphere utilizes Clerk's native password reset and verification flow.",
      code: "ENDPOINT_RETIRED",
    });
  });

  it("should return HTTP 410 Gone regardless of submitted payload content", async () => {
    const payloads = [
      {},
      { email: "invalid-email" },
      { email: "valid@example.com" },
      { email: "user@example.com", csrfToken: "random" },
    ];

    for (const payload of payloads) {
      const req = new NextRequest("http://localhost/api/auth/resend-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const res = await POST(req);
      expect(res.status).toBe(410);

      const body = await res.json();
      expect(body.code).toBe("ENDPOINT_RETIRED");
    }
  });

  it("should never return HTTP 200 or successful resend response", async () => {
    const req = new NextRequest("http://localhost/api/auth/resend-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@example.com" }),
    });

    const res = await POST(req);
    expect(res.status).not.toBe(200);

    const body = await res.json();
    expect(body.message).toBeUndefined();
  });

  it("should return HTTP 410 Gone on GET requests", async () => {
    const req = new NextRequest("http://localhost/api/auth/resend-otp", {
      method: "GET",
    });
    const res = await GET(req);
    expect(res.status).toBe(410);

    const body = await res.json();
    expect(body).toEqual({
      error:
        "This endpoint has been retired. WorkSphere utilizes Clerk's native password reset and verification flow.",
      code: "ENDPOINT_RETIRED",
    });
  });
});
