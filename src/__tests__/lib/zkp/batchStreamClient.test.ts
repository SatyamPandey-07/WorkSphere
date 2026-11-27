import { streamVerifyBatchStudentDiscountProofs } from "@/lib/zkp/batchStreamClient";

describe("Batch student verification stream client (#10608)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("cancels a pending reader cleanly when the signal is aborted", async () => {
    const abortController = new AbortController();
    let cancelCalled = false;

    const stream = new ReadableStream<Uint8Array>({
      cancel() {
        cancelCalled = true;
      },
    });

    jest.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      body: stream,
    } as Response);

    const resultPromise = streamVerifyBatchStudentDiscountProofs(
      {
        items: [
          {
            id: "student-1",
            proof: {},
            publicSignals: ["signal-1"],
          },
        ],
      },
      { signal: abortController.signal },
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    abortController.abort();

    const result = await resultPromise;

    expect(result.aborted).toBe(true);
    expect(result.events).toHaveLength(0);
    expect(cancelCalled).toBe(true);
  });

  it("returns immediately when the signal is already aborted", async () => {
    const abortController = new AbortController();
    abortController.abort();

    const fetchMock = jest.spyOn(global, "fetch");

    const result = await streamVerifyBatchStudentDiscountProofs(
      { items: [] },
      { signal: abortController.signal },
    );

    expect(result.aborted).toBe(true);
    expect(result.events).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

