import { NextRequest } from "next/server";
import { GET } from "@/app/api/metrics/telemetry/route";
import {
  recordConnectionDropped,
  recordConnectionOpened,
  recordReconnectAttempt,
  resetWsMetrics,
} from "@/lib/telemetry/wsMetrics";

const URL = "http://localhost:3000/api/metrics/telemetry";
const TOKEN = "scrape-token-for-tests";

function request(authorization?: string): NextRequest {
  return new NextRequest(URL, {
    headers: authorization ? { authorization } : {},
  });
}

describe("GET /api/metrics/telemetry", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, TELEMETRY_METRICS_TOKEN: TOKEN };
    resetWsMetrics();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns the metrics as Prometheus text for a valid bearer token", async () => {
    recordConnectionOpened();
    recordConnectionDropped("connection_lost");
    recordReconnectAttempt("connection_lost", 2000);

    const res = await GET(request(`Bearer ${TOKEN}`));
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "text/plain; version=0.0.4; charset=utf-8",
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body).toContain("worksphere_telemetry_ws_active_connections 1\n");
    expect(body).toContain(
      'worksphere_telemetry_ws_reconnect_attempts_total{reason="connection_lost"} 1\n',
    );
    expect(body).toContain(
      'worksphere_telemetry_ws_connection_drops_total{reason="connection_lost"} 1\n',
    );
    expect(body).toContain(
      'worksphere_telemetry_ws_backoff_duration_seconds_bucket{le="2"} 1\n',
    );
  });

  it("accepts a lowercase bearer scheme", async () => {
    const res = await GET(request(`bearer ${TOKEN}`));
    expect(res.status).toBe(200);
  });

  it.each([
    ["no Authorization header", undefined],
    ["a wrong token", "Bearer not-the-token"],
    ["a token that only shares a prefix", `Bearer ${TOKEN}-extra`],
    ["a non-bearer scheme", `Basic ${TOKEN}`],
    ["the bare token", TOKEN],
  ])("rejects %s with 401 and no metrics", async (_case, authorization) => {
    const res = await GET(request(authorization));
    const body = await res.text();

    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe("Bearer");
    expect(body).not.toContain("worksphere_telemetry_ws");
  });

  it("stays closed when no token is configured", async () => {
    delete process.env.TELEMETRY_METRICS_TOKEN;

    expect((await GET(request(`Bearer ${TOKEN}`))).status).toBe(401);
    expect((await GET(request("Bearer "))).status).toBe(401);
    expect((await GET(request())).status).toBe(401);
  });
});
