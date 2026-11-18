import { GET } from "@/app/api/security/offline-passcards/keys/route";

const PUB_KEY_A = {
  kty: "EC",
  crv: "P-256",
  x: "IwWS2R4U7Cy2eRCIXQI48oi6anob6NKcLR6dIuBomeE",
  y: "BigMwQiCn-va5Vir-gCK-KZJ_sj-6yZtcYzn8mhNFJk",
  use: "sig",
  alg: "ES256",
  kid: "key-2026-a",
};

describe("GET /api/security/offline-passcards/keys (#7820)", () => {
  const originalEnv = process.env.OFFLINE_PASSCARD_PUBLIC_JWKS;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.OFFLINE_PASSCARD_PUBLIC_JWKS = originalEnv;
    } else {
      delete process.env.OFFLINE_PASSCARD_PUBLIC_JWKS;
    }
  });

  it("returns 200 with public keys and cache headers when configured", async () => {
    process.env.OFFLINE_PASSCARD_PUBLIC_JWKS = JSON.stringify({
      keys: [PUB_KEY_A],
    });

    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.keys).toEqual([PUB_KEY_A]);
    expect(data.keys[0].d).toBeUndefined();

    const cacheControl = res.headers.get("Cache-Control");
    expect(cacheControl).toContain("public");
    expect(cacheControl).toContain("max-age=86400");
  });

  it("returns 200 with empty array when no keys configured", async () => {
    delete process.env.OFFLINE_PASSCARD_PUBLIC_JWKS;

    const res = await GET();
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.keys).toEqual([]);
  });

  it("returns 500 without leaking private details on malformed key configuration", async () => {
    process.env.OFFLINE_PASSCARD_PUBLIC_JWKS = "{ malformed json";

    const res = await GET();
    expect(res.status).toBe(500);

    const data = await res.json();
    expect(data.error).toBe("Public verification keys unavailable");
  });
});
