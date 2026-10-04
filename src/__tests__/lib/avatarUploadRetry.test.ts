/**
 * Tests for the exponential backoff retry logic in avatar upload (Issue #1549).
 * MAX_ATTEMPTS=3, BASE_DELAY_MS=500: delays are 500ms, 1000ms.
 */

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;

// Simulate the retry logic
async function uploadWithRetry(
  uploadFn: () => Promise<void>,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await uploadFn();
      return; // success
    } catch (err) {
      lastError = err;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }
  }
  throw lastError;
}

describe("Avatar upload exponential backoff retry", () => {
  it("succeeds on first attempt without retry", async () => {
    const upload = jest.fn().mockResolvedValue(undefined);
    const sleep = jest.fn().mockResolvedValue(undefined);

    await uploadWithRetry(upload, sleep);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries once on first failure, succeeds on second", async () => {
    const upload = jest.fn()
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValue(undefined);
    const sleep = jest.fn().mockResolvedValue(undefined);

    await uploadWithRetry(upload, sleep);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("first retry waits 500ms (BASE_DELAY * 2^0)", async () => {
    const upload = jest.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue(undefined);
    const sleep = jest.fn().mockResolvedValue(undefined);

    await uploadWithRetry(upload, sleep);
    expect(sleep).toHaveBeenCalledWith(500);
  });

  it("second retry waits 1000ms (BASE_DELAY * 2^1)", async () => {
    const upload = jest.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue(undefined);
    const sleep = jest.fn().mockResolvedValue(undefined);

    await uploadWithRetry(upload, sleep);
    expect(sleep).toHaveBeenCalledWith(500);  // first retry delay
    expect(sleep).toHaveBeenCalledWith(1000); // second retry delay
  });

  it("throws after MAX_ATTEMPTS all fail", async () => {
    const upload = jest.fn().mockRejectedValue(new Error("always fails"));
    const sleep = jest.fn().mockResolvedValue(undefined);

    await expect(uploadWithRetry(upload, sleep)).rejects.toThrow("always fails");
    expect(upload).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it("no sleep after final failed attempt", async () => {
    const upload = jest.fn().mockRejectedValue(new Error("fail"));
    const sleep = jest.fn().mockResolvedValue(undefined);

    try {
      await uploadWithRetry(upload, sleep);
    } catch { /* expected */ }

    // sleep called MAX_ATTEMPTS - 1 times
    expect(sleep).toHaveBeenCalledTimes(MAX_ATTEMPTS - 1);
  });
});
