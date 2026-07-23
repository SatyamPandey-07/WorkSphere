import { POST } from "@/app/api/user/notifications/route";
import { prisma } from "@/lib/prisma";
import { auth } from "@clerk/nextjs/server";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: jest.fn(),
  },
}));

describe("POST /api/user/notifications markAsRead — Concurrency & Deadlock Resilience (#1393)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (auth as unknown as jest.Mock).mockResolvedValue({
      userId: "user_test_456",
    });
  });

  it("handles serialization failure and retries successfully", async () => {
    const serializationError = new Error("Serialization failure 40001");
    (serializationError as any).code = "P2034";

    const mockTx = {
      $executeRaw: jest.fn(),
    };

    // First attempt: reject with serialization error
    // Second attempt: resolve successfully
    (prisma.$transaction as jest.Mock)
      .mockRejectedValueOnce(serializationError)
      .mockImplementationOnce(async (callback) => {
        return callback(mockTx);
      });

    const req = new Request("http://localhost:3000/api/user/notifications", {
      method: "POST",
      body: JSON.stringify({ action: "markAsRead" }),
    });

    const response = await POST(req);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    // Verified it was called twice (initial + 1 retry)
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it("fails immediately on non-retryable error", async () => {
    const dbError = new Error("Unique constraint violation");
    (dbError as any).code = "P2002";

    (prisma.$transaction as jest.Mock).mockRejectedValueOnce(dbError);

    const req = new Request("http://localhost:3000/api/user/notifications", {
      method: "POST",
      body: JSON.stringify({ action: "markAsRead" }),
    });

    const response = await POST(req);
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBe("Internal Server Error");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("runs concurrent update stress test without throw or failure", async () => {
    const mockTx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
    };

    // Mock first 3 requests having flaky database serialization failures/deadlocks, but succeeding on retry
    const serializationError = new Error("deadlock detected");
    (serializationError as any).code = "P2034";

    let callCount = 0;
    (prisma.$transaction as jest.Mock).mockImplementation(async (callback) => {
      callCount++;
      if (callCount <= 3) {
        throw serializationError;
      }
      return callback(mockTx);
    });

    // Fire 10 concurrent requests
    const promises = Array.from({ length: 10 }).map(async () => {
      const req = new Request("http://localhost:3000/api/user/notifications", {
        method: "POST",
        body: JSON.stringify({ action: "markAsRead" }),
      });
      return POST(req);
    });

    const responses = await Promise.all(promises);

    for (const res of responses) {
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    }

    // Since 3 failed initially, there should be at least 13 calls total (10 requests + 3 retries)
    expect(prisma.$transaction).toHaveBeenCalledTimes(13);
  });
});
