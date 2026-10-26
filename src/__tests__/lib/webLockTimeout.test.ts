/**
 * Tests for the WebLock timeout fix (Issue #2118).
 * The timeout path should throw LockTimeoutError, never run the callback.
 */

import { LockTimeoutError, withWebLock } from "../../lib/webLock";

describe("WebLock timeout behavior", () => {
  let originalLocks: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalLocks = Object.getOwnPropertyDescriptor(navigator, "locks");
  });

  afterEach(() => {
    if (originalLocks) {
      Object.defineProperty(navigator, "locks", originalLocks);
    } else {
      delete (navigator as any).locks;
    }
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("throws LockTimeoutError when lock cannot be acquired", async () => {
    const mockRequest = jest.fn().mockImplementation(() => new Promise(() => {}));
    Object.defineProperty(navigator, "locks", {
      value: { request: mockRequest },
      configurable: true,
      writable: true,
    });

    const callback = jest.fn().mockResolvedValue("result");
    const promise = withWebLock(callback, "test-lock", { timeoutMs: 50 });

    await expect(promise).rejects.toThrow(LockTimeoutError);
  });

  it("callback is NOT called when lock times out", async () => {
    const mockRequest = jest.fn().mockImplementation(() => new Promise(() => {}));
    Object.defineProperty(navigator, "locks", {
      value: { request: mockRequest },
      configurable: true,
      writable: true,
    });

    const callback = jest.fn().mockResolvedValue("result");

    try {
      await withWebLock(callback, "test-lock", { timeoutMs: 50 });
    } catch {
      // expected
    }

    expect(callback).not.toHaveBeenCalled();
  });

  it("LockTimeoutError message mentions the lock name", async () => {
    const mockRequest = jest.fn().mockImplementation(() => new Promise(() => {}));
    Object.defineProperty(navigator, "locks", {
      value: { request: mockRequest },
      configurable: true,
      writable: true,
    });

    try {
      await withWebLock(jest.fn(), "my-lock", { timeoutMs: 50 });
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
    expect(err.timeoutMs).toBe(5000);
  });

  it("executes callback successfully when lock is available", async () => {
    const mockRequest = jest.fn().mockImplementation((_name, cb) => cb());
    Object.defineProperty(navigator, "locks", {
      value: { request: mockRequest },
      configurable: true,
      writable: true,
    });

    const callback = jest.fn().mockResolvedValue("success");
    const result = await withWebLock(callback, "lock", 5000);
    expect(result).toBe("success");
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("LockTimeoutError is instanceof Error", () => {
    expect(new LockTimeoutError("x", 1000)).toBeInstanceOf(Error);
  });

  it("critical section is never executed without a held lock", async () => {
    const mockRequest = jest.fn().mockImplementation(() => new Promise(() => {}));
    Object.defineProperty(navigator, "locks", {
      value: { request: mockRequest },
      configurable: true,
      writable: true,
    });

    let criticalExecuted = false;
    const critical = async () => {
      criticalExecuted = true;
      return "done";
    };

    try {
      await withWebLock(critical, "lock", { timeoutMs: 50 });
    } catch {
      /* expected */
    }

    expect(criticalExecuted).toBe(false);
  });
});
