import { NextRequest } from "next/server";
import { POST } from "@/app/api/student/verify-batch/route";
import { verifyBatchStudentDiscountProofs } from "@/lib/zkp/batch";

jest.mock("@/lib/zkp/batch", () => ({
  verifyBatchStudentDiscountProofs: jest.fn(),
}));

describe("POST /api/student/verify-batch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("stops the response when the request aborts during batch verification", async () => {
    const controller = new AbortController();
    (verifyBatchStudentDiscountProofs as jest.Mock).mockImplementation(
      async (_body: unknown, signal: AbortSignal) => {
        expect(signal).toBe(controller.signal);
        controller.abort();
        return {
          valid: false,
          verifiedCount: 0,
          failedCount: 1,
          totalCount: 1,
          results: [],
          batchHash: "batch-hash",
        };
      },
    );

    const request = new NextRequest(
      "http://localhost/api/student/verify-batch",
      {
        method: "POST",
        body: JSON.stringify({
          items: [{ proof: {}, publicSignals: ["1"] }],
        }),
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      },
    );

    const response = await POST(request);

    expect(response.status).toBe(499);
    expect(await response.text()).toBe("");
  });
});
