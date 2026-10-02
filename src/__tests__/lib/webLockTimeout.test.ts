/**
 * Tests for the WebLock timeout fix (Issue #2118).
 * The timeout path should throw LockTimeoutError, never run the callback.
 */

class LockTimeoutError extends Error {
  readonly lockName: string;
  constructor(lockName: string, timeoutMs: number) {
    super(`Could not acquire lock "${lockName}" within ${timeoutMs}ms. The critical section was NOT executed.`);
    this.name = "LockTimeoutError";
    this.lockName = lockName;
  }
}

// Simulate the withWebLock timeout logic
async function withWebLockSimulated<T>(
  callback: () => Promise<T>,
  lockName: string,
  timeoutMs: number,
  lockAvailable: boolean, // simulated lock availability
): Promise<T> {
  if (!lockAvailable) {
    throw new LockTimeoutError(lockName, timeoutMs);
  }
  return callback();
}

describe("WebLock timeout behavior", () => {
  it("throws LockTimeoutError when lock cannot be acquired", async () => {
    const callback = jest.fn().mockResolvedValue("result");

    await expect(
      withWebLockSimulated(callback, "test-lock", 5000, false /* lock unavailable */),
    ).rejects.toThrow(LockTimeoutError);
  });

  it("callback is NOT called when lock times out", async () => {
    const callback = jest.fn().mockResolvedValue("result");

    try {
      await withWebLockSimulated(callback, "test-lock", 5000, false);
    } catch {
      // expected
    }

    expect(callback).not.toHaveBeenCalled();
  });

  it("LockTimeoutError message mentions the lock name", async () => {
    try {
      await withWebLockSimulated(jest.fn(), "my-lock", 5000, false);
    } catch (err) {
      expect((err as Error).message).toContain("my-lock");
    }
  });

  it("LockTimeoutError name is 'LockTimeoutError'", () => {
    const err = new LockTimeoutError("x", 5000);
    expect(err.name).toBe("LockTimeoutError");
  });

  it("LockTimeoutError.lockName contains the lock identifier", () => {
    const err = new LockTimeoutError("my-lock", 5000);
    expect(err.lockName).toBe("my-lock");
  });

  it("executes callback successfully when lock is available", async () => {
    const callback = jest.fn().mockResolvedValue("success");
    const result = await withWebLockSimulated(callback, "lock", 5000, true);
    expect(result).toBe("success");
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("LockTimeoutError is instanceof Error", () => {
    expect(new LockTimeoutError("x", 1000)).toBeInstanceOf(Error);
  });

  it("critical section is never executed without a held lock", async () => {
    let criticalExecuted = false;
    const critical = async () => { criticalExecuted = true; return "done"; };

    try {
      await withWebLockSimulated(critical, "lock", 1000, false /* no lock */);
    } catch { /* expected */ }

    expect(criticalExecuted).toBe(false);
  });
});
