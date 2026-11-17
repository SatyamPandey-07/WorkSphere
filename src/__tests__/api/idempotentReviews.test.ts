import {
  executeIdempotent,
  IdempotencyConflictError,
  clearIdempotencyStore,
  computePayloadHash,
} from "@/lib/idempotency";

describe("Idempotency Service", () => {
  beforeEach(() => {
    clearIdempotencyStore();
  });

  it("executes handler on first call and caches the response", async () => {
    let callCount = 0;
    const handler = async () => {
      callCount++;
      return { status: 201, body: { message: "Created", id: 123 } };
    };

    const first = await executeIdempotent(
      "review-key-1",
      { rating: 5 },
      handler,
    );
    expect(first.cacheHit).toBe(false);
    expect(first.response.status).toBe(201);
    expect(first.response.body).toEqual({ message: "Created", id: 123 });
    expect(callCount).toBe(1);

    // Second call with same key and payload returns cached response without invoking handler
    const second = await executeIdempotent(
      "review-key-1",
      { rating: 5 },
      handler,
    );
    expect(second.cacheHit).toBe(true);
    expect(second.response.status).toBe(201);
    expect(second.response.body).toEqual({ message: "Created", id: 123 });
    expect(callCount).toBe(1);
  });

  it("throws IdempotencyConflictError when key is reused with different payload", async () => {
    const handler = async () => ({ status: 200, body: { ok: true } });

    await executeIdempotent(
      "review-key-2",
      { rating: 5, comment: "Great" },
      handler,
    );

    await expect(
      executeIdempotent("review-key-2", { rating: 1, comment: "Bad" }, handler),
    ).rejects.toThrow(IdempotencyConflictError);
  });

  it("deduplicates concurrent in-flight requests for the same key", async () => {
    let callCount = 0;
    const handler = async () => {
      callCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { status: 200, body: { data: "success" } };
    };

    const [res1, res2] = await Promise.all([
      executeIdempotent("review-key-concurrent", { action: "submit" }, handler),
      executeIdempotent("review-key-concurrent", { action: "submit" }, handler),
    ]);

    expect(callCount).toBe(1);
    expect(res1.response).toEqual(res2.response);
  });

  it("computes deterministic payload hashes", () => {
    const hash1 = computePayloadHash({ a: 1, b: 2 });
    const hash2 = computePayloadHash({ a: 1, b: 2 });
    expect(hash1).toBe(hash2);
    expect(typeof hash1).toBe("string");
  });
});
