import { NextRequest } from "next/server";
import {
  DEFAULT_MAX_SPEEDTEST_UPLOAD_BYTES,
  POST,
  SPEEDTEST_UPLOAD_RATE_LIMIT,
} from "@/app/api/telemetry/speedtest/upload/route";
import { resetRateLimit } from "@/lib/rateLimit";

describe("POST /api/telemetry/speedtest/upload - Payload Limits & Streaming Guard (#10193)", () => {
  const originalEnvLimit = process.env.SPEEDTEST_MAX_UPLOAD_BYTES;

  beforeEach(() => {
    delete process.env.SPEEDTEST_MAX_UPLOAD_BYTES;
    resetRateLimit();
  });

  afterAll(() => {
    if (originalEnvLimit === undefined) {
      delete process.env.SPEEDTEST_MAX_UPLOAD_BYTES;
    } else {
      process.env.SPEEDTEST_MAX_UPLOAD_BYTES = originalEnvLimit;
    }
  });

  function makeUploadRequest({
    body,
    contentLength,
    ip = "203.0.113.10",
  }: {
    body?: Uint8Array | ReadableStream<Uint8Array>;
    contentLength?: string;
    ip?: string;
  }): NextRequest {
    const headers = new Headers({
      "content-type": "application/octet-stream",
      "x-forwarded-for": ip,
    });
    if (contentLength !== undefined) {
      headers.set("content-length", contentLength);
    }

    const req = new NextRequest(
      "http://localhost:3000/api/telemetry/speedtest/upload",
      {
        method: "POST",
        headers,
        body: body as BodyInit | undefined,
        ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
      } as RequestInit,
    );
    return req;
  }

  it("accepts the normal 1.5 MiB benchmark payload and returns the expected response contract", async () => {
    const benchmarkBytes = 1_572_864;
    const payload = new Uint8Array(benchmarkBytes);

    const res = await POST(
      makeUploadRequest({
        body: payload,
        contentLength: String(benchmarkBytes),
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.bytesReceived).toBe(benchmarkBytes);
    expect(typeof data.receivedAt).toBe("number");
  });

  it("accepts a payload at the exact configured maximum size boundary", async () => {
    process.env.SPEEDTEST_MAX_UPLOAD_BYTES = "4096";
    const exactPayload = new Uint8Array(4096);

    const res = await POST(
      makeUploadRequest({
        body: exactPayload,
        contentLength: "4096",
      }),
    );
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.bytesReceived).toBe(4096);
    expect(DEFAULT_MAX_SPEEDTEST_UPLOAD_BYTES).toBe(2 * 1024 * 1024);
  });

  it("rejects oversized requests immediately via Content-Length with HTTP 413 without reading the stream", async () => {
    let chunksPulled = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          chunksPulled++;
          controller.enqueue(new Uint8Array(1024));
        },
      },
      { highWaterMark: 0 },
    );
    const getReaderSpy = jest.spyOn(stream, "getReader");

    const req = makeUploadRequest({
      body: stream,
      contentLength: String(DEFAULT_MAX_SPEEDTEST_UPLOAD_BYTES + 1),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(413);
    expect(data.error).toMatch(/Payload Too Large/i);
    expect(getReaderSpy).not.toHaveBeenCalled();
    expect(chunksPulled).toBe(0);
  });

  it("rejects invalid malformed Content-Length headers with HTTP 400", async () => {
    const req = makeUploadRequest({
      body: new Uint8Array(16),
      contentLength: "not-a-number",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("handles missing Content-Length for valid payloads", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(512));
        controller.enqueue(new Uint8Array(512));
        controller.close();
      },
    });

    const res = await POST(makeUploadRequest({ body: stream }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.bytesReceived).toBe(1024);
  });

  it("stops streaming and returns 413 when streamed bytes exceed the limit despite missing Content-Length", async () => {
    process.env.SPEEDTEST_MAX_UPLOAD_BYTES = "2048";

    let pulledChunks = 0;
    let streamCancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulledChunks++;
        if (pulledChunks > 10) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(1024));
      },
      cancel() {
        streamCancelled = true;
      },
    });

    const res = await POST(makeUploadRequest({ body: stream }));
    expect(res.status).toBe(413);
    expect(streamCancelled).toBe(true);
    // Chunk 1 = 1024, Chunk 2 = 2048, Chunk 3 = 3072 > 2048 -> stopped cleanly before reading all 10 chunks
    expect(pulledChunks).toBeLessThan(5);
  });

  it("rejects spoofed small Content-Length when actual streamed body exceeds the maximum", async () => {
    process.env.SPEEDTEST_MAX_UPLOAD_BYTES = "2048";

    let cancelled = false;
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled++;
          if (pulled > 10) {
            controller.close();
            return;
          }
          controller.enqueue(new Uint8Array(1500));
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );

    const res = await POST(
      makeUploadRequest({
        body: stream,
        contentLength: "100",
      }),
    );

    expect(res.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(pulled).toBe(2); // 1500 + 1500 = 3000 > 2048
  });

  it("enforces per-IP rate limiting and returns 429 with Retry-After", async () => {
    let lastRes;
    for (let i = 0; i <= SPEEDTEST_UPLOAD_RATE_LIMIT; i++) {
      lastRes = await POST(
        makeUploadRequest({
          body: new Uint8Array(64),
          contentLength: "64",
          ip: "198.51.100.77",
        }),
      );
    }

    expect(lastRes!.status).toBe(429);
    expect(lastRes!.headers.get("Retry-After")).toBeTruthy();
  });
});
