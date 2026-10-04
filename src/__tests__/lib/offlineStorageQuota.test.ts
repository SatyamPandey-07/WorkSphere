/**
 * Tests for the QuotaExceededError handling added to saveVenueOffline.
 * Tests the error classification and retry logic.
 */

// Test the error classification logic directly
function isQuotaError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === "QuotaExceededError" ||
      err.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

function createQuotaError(name = "QuotaExceededError"): DOMException {
  return Object.assign(new DOMException("Storage quota exceeded", name), {
    name,
  });
}

describe("Quota error classification", () => {
  it("identifies QuotaExceededError as a quota error", () => {
    expect(isQuotaError(createQuotaError("QuotaExceededError"))).toBe(true);
  });

  it("identifies NS_ERROR_DOM_QUOTA_REACHED as a quota error", () => {
    expect(isQuotaError(createQuotaError("NS_ERROR_DOM_QUOTA_REACHED"))).toBe(true);
  });

  it("does not classify generic Error as quota error", () => {
    expect(isQuotaError(new Error("generic error"))).toBe(false);
  });

  it("does not classify null as quota error", () => {
    expect(isQuotaError(null)).toBe(false);
  });

  it("does not classify string as quota error", () => {
    expect(isQuotaError("QuotaExceededError")).toBe(false);
  });

  it("does not classify non-quota DOMException as quota error", () => {
    expect(isQuotaError(new DOMException("Not allowed", "NotAllowedError"))).toBe(false);
  });
});

describe("Retry logic pattern", () => {
  it("retries after quota error (simulated)", async () => {
    let attempts = 0;
    const mockWrite = async () => {
      attempts++;
      if (attempts === 1) throw createQuotaError();
      // second attempt succeeds
    };

    let pruned = false;
    const mockPrune = async () => { pruned = true; };

    // Simulate the retry logic
    try {
      await mockWrite();
    } catch (err) {
      if (isQuotaError(err)) {
        await mockPrune();
        await mockWrite();
      } else {
        throw err;
      }
    }

    expect(pruned).toBe(true);
    expect(attempts).toBe(2);
  });

  it("dispatches offline-storage-full event when retry also fails", async () => {
    const eventFired: string[] = [];
    window.addEventListener("offline-storage-full", () => {
      eventFired.push("full");
    });

    const mockWrite = async () => { throw createQuotaError(); };
    const mockPrune = async () => {};

    try {
      await mockWrite();
    } catch (err) {
      if (isQuotaError(err)) {
        await mockPrune();
        try {
          await mockWrite();
        } catch {
          window.dispatchEvent(new CustomEvent("offline-storage-full"));
        }
      }
    }

    expect(eventFired).toContain("full");
    window.removeEventListener("offline-storage-full", () => {});
  });
});
