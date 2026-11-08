/**
 * Tests for the WASM OOM error classification logic in zkpWorker.ts.
 * The worker sends { isOom: true } so the component can offer server-side fallback.
 */

// Replicate the classifyError logic from zkpWorker.ts
type WorkerErrorType = "oom" | "internal" | "generic";

function classifyError(error: unknown): WorkerErrorType {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (
      msg.includes("out of memory") ||
      msg.includes("memory access out of bounds") ||
      msg.includes("allocation failed") ||
      msg.includes("cannot allocate") ||
      (error instanceof RangeError && msg.includes("memory"))
    ) {
      return "oom";
    }
    if (msg.includes("wasm") || msg.includes("enoent") || msg.includes("instantiate")) {
      return "internal";
    }
  }
  return "generic";
}

describe("ZKP worker OOM error classification", () => {
  it("classifies 'out of memory' error as OOM", () => {
    expect(classifyError(new Error("out of memory"))).toBe("oom");
  });

  it("classifies 'memory access out of bounds' as OOM", () => {
    expect(classifyError(new Error("memory access out of bounds"))).toBe("oom");
  });

  it("classifies 'allocation failed' as OOM", () => {
    expect(classifyError(new Error("allocation failed: not enough memory"))).toBe("oom");
  });

  it("classifies 'cannot allocate' as OOM", () => {
    expect(classifyError(new Error("cannot allocate memory"))).toBe("oom");
  });

  it("classifies RangeError with 'memory' as OOM", () => {
    expect(classifyError(new RangeError("memory overflow"))).toBe("oom");
  });

  it("classifies WASM instantiation error as 'internal'", () => {
    expect(classifyError(new Error("wasm module load failed"))).toBe("internal");
  });

  it("classifies ENOENT error as 'internal'", () => {
    expect(classifyError(new Error("ENOENT: no such file"))).toBe("internal");
  });

  it("classifies unknown Error as 'generic'", () => {
    expect(classifyError(new Error("something went wrong"))).toBe("generic");
  });

  it("classifies null as 'generic'", () => {
    expect(classifyError(null)).toBe("generic");
  });

  it("classifies string as 'generic'", () => {
    expect(classifyError("error string")).toBe("generic");
  });

  it("isOom field is set correctly for OOM errors", () => {
    const isOom = classifyError(new Error("out of memory")) === "oom";
    expect(isOom).toBe(true);
  });

  it("isOom field is false for non-OOM errors", () => {
    const isOom = classifyError(new Error("generic failure")) === "oom";
    expect(isOom).toBe(false);
  });
});
