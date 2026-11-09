import { classifyError } from "../../workers/zkpWorker";

describe("zkpWorker WASM OOM classification and error handling", () => {
  it("classifies RangeError WebAssembly.Memory allocation failure as oom", () => {
    const error = new RangeError(
      "WebAssembly.Memory(): could not allocate memory",
    );
    expect(classifyError(error)).toBe("oom");
  });

  it("classifies out of memory error messages as oom", () => {
    const error1 = new Error("Out of memory");
    const error2 = new Error("Memory access out of bounds");
    const error3 = new Error("Cannot allocate memory buffer");

    expect(classifyError(error1)).toBe("oom");
    expect(classifyError(error2)).toBe("oom");
    expect(classifyError(error3)).toBe("oom");
  });

  it("classifies timeout errors as timeout", () => {
    const error = new Error("VERIFICATION_TIMEOUT");
    expect(classifyError(error)).toBe("timeout");
  });

  it("classifies WebAssembly instantiation errors as internal", () => {
    const error = new Error("Failed to instantiate WASM module");
    expect(classifyError(error)).toBe("internal");
  });
});
