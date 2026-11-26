import { POST } from "@/app/api/student/verify-batch/route";
import { NextRequest } from "next/server";
import * as batchLib from "@/lib/zkp/batch";

jest.mock("@/lib/zkp/batch", () => {
  const actual = jest.requireActual("@/lib/zkp/batch");
  return {
    ...actual,
    verifyBatchStudentDiscountProofs: jest.fn(),
  };
});

describe("Batch Student Discount Verification API (/api/student/verify-batch) (#10541)", () => {
  const mockVerifyBatch = batchLib.verifyBatchStudentDiscountProofs as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("JSON response behavior (Accept: application/json)", () => {
    it("returns validation error 400 when body has empty or missing items", async () => {
      const req = new NextRequest("http://localhost:3000/api/student/verify-batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ items: [] }),
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("array is required");
    });

    it("returns 200 with JSON result when all items valid", async () => {
      mockVerifyBatch.mockResolvedValueOnce({
        valid: true,
        verifiedCount: 2,
        failedCount: 0,
        totalCount: 2,
        results: [
          { index: 0, id: "item-1", valid: true, discountEligible: true },
          { index: 1, id: "item-2", valid: true, discountEligible: true },
        ],
        batchHash: "hash-123",
      });

      const req = new NextRequest("http://localhost:3000/api/student/verify-batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          items: [
            { id: "item-1", proof: {}, publicSignals: ["sig1"] },
            { id: "item-2", proof: {}, publicSignals: ["sig2"] },
          ],
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.valid).toBe(true);
      expect(data.verifiedCount).toBe(2);
      expect(mockVerifyBatch).toHaveBeenCalledTimes(1);
    });

    it("returns 207 Multi-Status when some items fail verification", async () => {
      mockVerifyBatch.mockResolvedValueOnce({
        valid: false,
        verifiedCount: 1,
        failedCount: 1,
        totalCount: 2,
        results: [
          { index: 0, id: "item-1", valid: true, discountEligible: true },
          { index: 1, id: "item-2", valid: false, discountEligible: false, error: "Invalid proof" },
        ],
        batchHash: "hash-123",
      });

      const req = new NextRequest("http://localhost:3000/api/student/verify-batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          items: [
            { id: "item-1", proof: {}, publicSignals: ["sig1"] },
            { id: "item-2", proof: {}, publicSignals: ["sig2"] },
          ],
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(207);
      const data = await res.json();
      expect(data.valid).toBe(false);
      expect(data.failedCount).toBe(1);
    });
  });

  describe("NDJSON streaming behavior (Accept: application/x-ndjson)", () => {
    it("streams incremental progress events and final completion event", async () => {
      mockVerifyBatch
        .mockResolvedValueOnce({
          valid: true,
          verifiedCount: 1,
          failedCount: 0,
          totalCount: 1,
          results: [{ index: 0, id: "item-1", valid: true, discountEligible: true, discountCode: "STUDENT20" }],
          batchHash: "single-1",
        })
        .mockResolvedValueOnce({
          valid: true,
          verifiedCount: 1,
          failedCount: 0,
          totalCount: 1,
          results: [{ index: 0, id: "item-2", valid: true, discountEligible: true, discountCode: "STUDENT20" }],
          batchHash: "single-2",
        });

      const req = new NextRequest("http://localhost:3000/api/student/verify-batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify({
          items: [
            { id: "item-1", proof: {}, publicSignals: ["sig1"] },
            { id: "item-2", proof: {}, publicSignals: ["sig2"] },
          ],
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("application/x-ndjson");

      const text = await res.text();
      const lines = text.trim().split("\n").filter(Boolean);
      expect(lines.length).toBe(3); // 2 progress events + 1 completion event

      const event1 = JSON.parse(lines[0]);
      expect(event1.type).toBe("progress");
      expect(event1.item.id).toBe("item-1");
      expect(event1.item.valid).toBe(true);
      expect(event1.progress).toEqual({
        current: 1,
        total: 2,
        percentage: 50,
      });

      const event2 = JSON.parse(lines[1]);
      expect(event2.type).toBe("progress");
      expect(event2.item.id).toBe("item-2");
      expect(event2.item.valid).toBe(true);
      expect(event2.progress).toEqual({
        current: 2,
        total: 2,
        percentage: 100,
      });

      const completionEvent = JSON.parse(lines[2]);
      expect(completionEvent.type).toBe("complete");
      expect(completionEvent.data.valid).toBe(true);
      expect(completionEvent.data.verifiedCount).toBe(2);
      expect(completionEvent.data.failedCount).toBe(0);
      expect(completionEvent.data.totalCount).toBe(2);
      expect(completionEvent.data.results).toHaveLength(2);
    });

    it("handles per-item verification failures without terminating stream early", async () => {
      mockVerifyBatch
        .mockResolvedValueOnce({
          valid: true,
          verifiedCount: 1,
          failedCount: 0,
          totalCount: 1,
          results: [{ index: 0, id: "item-1", valid: true, discountEligible: true }],
          batchHash: "single-1",
        })
        .mockRejectedValueOnce(new Error("ZKP verification failed for proof"))
        .mockResolvedValueOnce({
          valid: true,
          verifiedCount: 1,
          failedCount: 0,
          totalCount: 1,
          results: [{ index: 0, id: "item-3", valid: true, discountEligible: true }],
          batchHash: "single-3",
        });

      const req = new NextRequest("http://localhost:3000/api/student/verify-batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        body: JSON.stringify({
          items: [
            { id: "item-1", proof: {}, publicSignals: ["sig1"] },
            { id: "item-2", proof: {}, publicSignals: ["sig2"] },
            { id: "item-3", proof: {}, publicSignals: ["sig3"] },
          ],
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const text = await res.text();
      const lines = text.trim().split("\n").filter(Boolean);
      expect(lines.length).toBe(4); // 3 progress events + 1 completion event

      const event2 = JSON.parse(lines[1]);
      expect(event2.type).toBe("progress");
      expect(event2.item.id).toBe("item-2");
      expect(event2.item.valid).toBe(false);
      expect(event2.item.error).toContain("ZKP verification failed");

      const completionEvent = JSON.parse(lines[3]);
      expect(completionEvent.type).toBe("complete");
      expect(completionEvent.data.valid).toBe(false);
      expect(completionEvent.data.verifiedCount).toBe(2);
      expect(completionEvent.data.failedCount).toBe(1);
      expect(completionEvent.data.totalCount).toBe(3);
    });

    it("handles stream cancellation cleanly when client aborts signal", async () => {
      const abortController = new AbortController();
      abortController.abort(); // already aborted

      const req = new NextRequest("http://localhost:3000/api/student/verify-batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
        },
        signal: abortController.signal,
        body: JSON.stringify({
          items: [{ id: "item-1", proof: {}, publicSignals: ["sig1"] }],
        }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe("");
    });
  });
});
