import { NextRequest } from "next/server";
import {
  POST,
  resetBookingMutationQueues,
  decompressGzipStream,
  MAX_COMPRESSED_BODY_BYTES,
  MAX_DECOMPRESSED_BODY_BYTES,
} from "@/app/api/bookings/sync/route";
import {
  compressPayloadGzip,
  isCompressionEligible,
  OfflineMutationQueue,
} from "@/core/sync/OfflineMutationQueue";
import * as zlib from "node:zlib";

function createGzipBody(payload: unknown): Uint8Array {
  const jsonStr = JSON.stringify(payload);
  return zlib.gzipSync(Buffer.from(jsonStr, "utf-8"));
}

describe("Issue #9728 - CRDT Differential Update Compression Using zlib Deflate / gzip", () => {
  beforeEach(() => {
    resetBookingMutationQueues();
  });

  describe("Server-Side Streaming Decompression (/api/bookings/sync)", () => {
    it("successfully decompresses and processes valid gzip-compressed request", async () => {
      const payload = {
        draftId: "booking-gz-1",
        clientId: "client-gz",
        vectorClock: { "client-gz": 1 },
        draftPayload: { seatId: "desk-gz-1", status: "CONFIRMED", notes: "Compressed booking" },
      };

      const compressedBytes = createGzipBody(payload);

      const req = new NextRequest("http://localhost/api/bookings/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
        },
        body: compressedBytes,
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.action).toBe("MERGED");
      expect(data.resolvedPayload).toMatchObject({
        seatId: "desk-gz-1",
        status: "CONFIRMED",
        notes: "Compressed booking",
      });
      expect(data.newVersion).toBe(1);
    });

    it("accepts uncompressed legacy requests without Content-Encoding header", async () => {
      const payload = {
        draftId: "booking-legacy-1",
        clientId: "client-legacy",
        vectorClock: { "client-legacy": 1 },
        draftPayload: { seatId: "desk-legacy-1" },
      };

      const req = new NextRequest("http://localhost/api/bookings/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.resolvedPayload).toMatchObject({ seatId: "desk-legacy-1" });
    });

    it("accepts uncompressed requests explicitly advertising Content-Encoding: identity", async () => {
      const payload = {
        draftId: "booking-identity-1",
        clientId: "client-identity",
        vectorClock: { "client-identity": 1 },
        draftPayload: { seatId: "desk-identity-1" },
      };

      const req = new NextRequest("http://localhost/api/bookings/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "identity",
        },
        body: JSON.stringify(payload),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it("rejects unsupported Content-Encoding with 415 Unsupported Media Type", async () => {
      const req = new NextRequest("http://localhost/api/bookings/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "br", // Brotli not supported on sync endpoint
        },
        body: JSON.stringify({ draftId: "b1", draftPayload: {} }),
      });

      const res = await POST(req);
      expect(res.status).toBe(415);
      const data = await res.json();
      expect(data.error).toContain("Unsupported Media Type");
    });

    it("rejects invalid or corrupted gzip data with 400 Bad Request", async () => {
      const invalidGzipBytes = Buffer.from("this is definitely not valid gzip data");

      const req = new NextRequest("http://localhost/api/bookings/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
        },
        body: invalidGzipBytes,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid gzip compressed data");
    });

    it("rejects truncated gzip stream with 400 Bad Request", async () => {
      const fullGzip = createGzipBody({ draftId: "b-trunc", draftPayload: { test: 123 } });
      const truncated = fullGzip.subarray(0, 15); // cut off stream mid-header

      const req = new NextRequest("http://localhost/api/bookings/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
        },
        body: truncated,
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Invalid gzip compressed data");
    });

    it("rejects compressed payloads exceeding MAX_COMPRESSED_BODY_BYTES with 413 Payload Too Large", async () => {
      // Simulate by calling decompressGzipStream with small limit
      const fakeGzip = Buffer.alloc(500, 0x1f);
      const req = new NextRequest("http://localhost/api/bookings/sync", {
        method: "POST",
        headers: { "Content-Encoding": "gzip" },
        body: fakeGzip,
      });

      await expect(decompressGzipStream(req, 200, MAX_DECOMPRESSED_BODY_BYTES)).rejects.toThrow(
        "Compressed payload exceeded maximum allowed size",
      );
    });

    it("rejects decompressed output exceeding MAX_DECOMPRESSED_BODY_BYTES (zip bomb guard) with 413", async () => {
      const bombPayload = JSON.stringify({
        draftId: "b-bomb",
        draftPayload: { bigData: "A".repeat(50_000) },
      });
      const bombGzip = zlib.gzipSync(Buffer.from(bombPayload));

      const req = new NextRequest("http://localhost/api/bookings/sync", {
        method: "POST",
        headers: { "Content-Encoding": "gzip" },
        body: bombGzip,
      });

      await expect(decompressGzipStream(req, MAX_COMPRESSED_BODY_BYTES, 5_000)).rejects.toThrow(
        "Decompressed payload exceeded maximum allowed size",
      );
    });
  });

  describe("Client-Side Compression & Eligibility (OfflineMutationQueue)", () => {
    it("evaluates compression eligibility based on batch mutation count and payload size", () => {
      // 1. Small mutation count (<= 5) and small byte size -> ineligible
      expect(isCompressionEligible(1, 100)).toBe(false);
      expect(isCompressionEligible(5, 200)).toBe(false);

      // 2. Larger mutation count (> 5) -> eligible
      expect(isCompressionEligible(6, 500)).toBe(true);

      // 3. Large byte payload (>= 256 bytes) even with fewer mutations -> eligible
      expect(isCompressionEligible(2, 400)).toBe(true);

      // 4. Ineligible if compressed output size exceeds or equals original uncompressed size
      expect(isCompressionEligible(6, 1000, 1050)).toBe(false);
      expect(isCompressionEligible(6, 1000, 400)).toBe(true);
    });

    it("compresses large mutation payload using compressPayloadGzip and sets Content-Encoding: gzip", async () => {
      const queue = new OfflineMutationQueue({ autoFlush: false });
      const largePayload = {
        draftId: "draft-batch-1",
        mutations: Array.from({ length: 8 }, (_, i) => ({
          id: `mut-${i}`,
          clientId: "client-batch",
          vectorClock: { "client-batch": i + 1 },
          payload: {
            seatId: `seat-${i}`,
            time: 1700000000 + i * 3600,
            notes: `Nomad remote desk booking request item ${i}`,
            amenities: ["HIGH_SPEED_WIFI", "ERGONOMIC_CHAIR", "COFFEE_PASS"],
          },
        })),
      };

      const capturedRequests: Array<{ url: string; init: RequestInit }> = [];
      const mockFetch = jest.fn().mockImplementation(async (url, init) => {
        capturedRequests.push({ url, init });
        return { ok: true, status: 200 };
      });

      (queue as any).fetchFn = mockFetch;

      await queue.enqueue({
        endpoint: "/api/bookings/sync",
        method: "POST",
        payload: largePayload,
      });

      const res = await queue.flush();
      expect(res.succeeded).toBe(1);
      expect(capturedRequests.length).toBe(1);

      const sentHeaders = capturedRequests[0].init.headers as Record<string, string>;
      expect(sentHeaders["Content-Encoding"]).toBe("gzip");
      expect(capturedRequests[0].init.body).toBeInstanceOf(Uint8Array);

      // Verify server can decompress the body sent by client exactly
      const decompressed = zlib.gunzipSync(Buffer.from(capturedRequests[0].init.body as Uint8Array));
      const parsed = JSON.parse(decompressed.toString("utf-8"));
      expect(parsed).toEqual(largePayload);
    });

    it("leaves small mutation uncompressed without Content-Encoding: gzip", async () => {
      const queue = new OfflineMutationQueue({ autoFlush: false });
      const smallPayload = {
        draftId: "d1",
        draftPayload: { seatId: "s1" },
      };

      const capturedRequests: Array<{ url: string; init: RequestInit }> = [];
      const mockFetch = jest.fn().mockImplementation(async (url, init) => {
        capturedRequests.push({ url, init });
        return { ok: true, status: 200 };
      });

      (queue as any).fetchFn = mockFetch;

      await queue.enqueue({
        endpoint: "/api/bookings/sync",
        method: "POST",
        payload: smallPayload,
      });

      await queue.flush();
      expect(capturedRequests.length).toBe(1);

      const sentHeaders = capturedRequests[0].init.headers as Record<string, string>;
      expect(sentHeaders["Content-Encoding"]).toBeUndefined();
      expect(typeof capturedRequests[0].init.body).toBe("string");
      expect(JSON.parse(capturedRequests[0].init.body as string)).toEqual(smallPayload);
    });
  });

  describe("End-to-End Performance & Compression Ratio", () => {
    it("achieves > 60% byte reduction on representative mutation batches (> 5 items)", async () => {
      // Representative CRDT differential update batch containing 7 mutations
      const representativeBatch = {
        draftId: "booking-crdt-rep-1",
        clientId: "nomad-laptop-client",
        vectorClock: { "nomad-laptop-client": 7 },
        mutations: [
          {
            id: "mut-001",
            clientId: "nomad-laptop-client",
            vectorClock: { "nomad-laptop-client": 1 },
            payload: {
              seatId: "standing-desk-4",
              venueId: "venue-berlin-01",
              status: "DRAFT",
              date: "2026-11-25",
              timeSlot: "09:00-17:00",
            },
          },
          {
            id: "mut-002",
            clientId: "nomad-laptop-client",
            vectorClock: { "nomad-laptop-client": 2 },
            parentClock: { "nomad-laptop-client": 1 },
            payload: {
              customerEmail: "nomad.developer@worksphere.io",
              customerPhone: "+491701234567",
              projectBillingCode: "PROJ-BER-2026",
            },
          },
          {
            id: "mut-003",
            clientId: "nomad-laptop-client",
            vectorClock: { "nomad-laptop-client": 3 },
            parentClock: { "nomad-laptop-client": 2 },
            payload: {
              amenitiesNeeded: ["MONITOR_4K", "STANDING_DESK", "FIBER_WIFI", "PHONE_BOOTH"],
              specialRequests: "Quiet corner with natural daylight for video conference",
            },
          },
          {
            id: "mut-004",
            clientId: "nomad-laptop-client",
            vectorClock: { "nomad-laptop-client": 4 },
            parentClock: { "nomad-laptop-client": 3 },
            payload: {
              guestPasses: [
                { name: "Alex Mueller", email: "alex@partner.de" },
                { name: "Elena Rostova", email: "elena@nomadtech.org" },
              ],
            },
          },
          {
            id: "mut-005",
            clientId: "nomad-laptop-client",
            vectorClock: { "nomad-laptop-client": 5 },
            parentClock: { "nomad-laptop-client": 4 },
            payload: {
              crdtVectorState: "AAAAAQEBAQICAgICBAQEBAUGFRUWGhkbHB0eHyAhIiMkJSYnKCk=",
              crdtDeltaUpdate: "BgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2",
            },
          },
          {
            id: "mut-006",
            clientId: "nomad-laptop-client",
            vectorClock: { "nomad-laptop-client": 6 },
            parentClock: { "nomad-laptop-client": 5 },
            payload: {
              paymentIntent: "pi_solana_escrow_deposit_confirmed",
              escrowVault: "7Y5pAYERwallet1111111111111111111111111111",
              lamports: 150000000,
            },
          },
          {
            id: "mut-007",
            clientId: "nomad-laptop-client",
            vectorClock: { "nomad-laptop-client": 7 },
            parentClock: { "nomad-laptop-client": 6 },
            payload: {
              status: "CONFIRMED",
              confirmedAt: 1795461120000,
              checkInCode: "WS-BER-9728",
            },
          },
        ],
      };

      const serializedString = JSON.stringify(representativeBatch);
      const originalBytes = Buffer.byteLength(serializedString, "utf-8");

      const compressed = await compressPayloadGzip(serializedString);
      expect(compressed).not.toBeNull();

      const compressedBytes = compressed!.length;
      const byteReduction = ((originalBytes - compressedBytes) / originalBytes) * 100;

      // Assertion: byte reduction must exceed 60%
      expect(byteReduction).toBeGreaterThan(60);

      // Fidelity Assertion: decompressing yields exact byte-for-byte identical JSON
      const decompressedBuf = zlib.gunzipSync(Buffer.from(compressed!));
      const decompressedString = decompressedBuf.toString("utf-8");
      expect(decompressedString).toBe(serializedString);

      const parsed = JSON.parse(decompressedString);
      expect(parsed.mutations.length).toBe(7);
      expect(parsed.mutations[4].payload.crdtVectorState).toBe(
        representativeBatch.mutations[4].payload.crdtVectorState,
      );
    });
  });
});
