import {
  isWasmSimdSupported,
  toSimdLimbs,
  fromSimdLimbs,
  simdBatchFieldAdd,
  simdBatchMontgomeryMul,
  getOptimizedZkpOptions,
  BN254_R,
} from "@/lib/zkp/wasmSimd";

describe("WebAssembly SIMD Groth16 Vectorization & Optimization", () => {
  it("detects WebAssembly SIMD support in the runtime environment", async () => {
    const isSupported = await isWasmSimdSupported();
    expect(typeof isSupported).toBe("boolean");
  });

  it("converts 256-bit BigInt to and from 4 x 64-bit SIMD limbs accurately", () => {
    const testValue = BigInt("0x123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0");
    const limbs = toSimdLimbs(testValue);

    expect(limbs.l0).toBeDefined();
    expect(limbs.l1).toBeDefined();
    expect(limbs.l2).toBeDefined();
    expect(limbs.l3).toBeDefined();

    const reconstructed = fromSimdLimbs(limbs);
    expect(reconstructed).toEqual(testValue);
  });

  it("correctly computes vectorized batch field addition modulo BN254_R", () => {
    const a = [100n, BN254_R - 10n, 0n];
    const b = [200n, 20n, 50n];

    const result = simdBatchFieldAdd(a, b);

    expect(result).toHaveLength(3);
    expect(result[0]).toBe(300n);
    expect(result[1]).toBe(10n); // (r - 10 + 20) mod r = 10
    expect(result[2]).toBe(50n);
  });

  it("correctly computes vectorized batch field multiplication modulo BN254_R", () => {
    const a = [5n, 12n, BN254_R - 1n];
    const b = [7n, 10n, 2n];

    const result = simdBatchMontgomeryMul(a, b);

    expect(result).toHaveLength(3);
    expect(result[0]).toBe(35n);
    expect(result[1]).toBe(120n);
    expect(result[2]).toBe(BN254_R - 2n);
  });

  it("returns optimized witness calculation and prover execution options", async () => {
    const options = await getOptimizedZkpOptions();

    expect(options).toHaveProperty("simdEnabled");
    expect(options).toHaveProperty("proverOptions");
    expect(options.proverOptions.singleThread).toBe(true);
    expect(options.witnessOptions).toHaveProperty("memorySize");
  });

  it("degrades gracefully to scalar WASM when SIMD bytecode validation fails", async () => {
    const { _resetSimdCacheForTests } = await import("@/lib/zkp/wasmSimd");
    _resetSimdCacheForTests();

    const originalValidate = WebAssembly.validate;
    WebAssembly.validate = jest.fn().mockReturnValue(false);

    try {
      const isSupported = await isWasmSimdSupported();
      expect(isSupported).toBe(false);

      const options = await getOptimizedZkpOptions();
      expect(options.simdEnabled).toBe(false);
      expect(options.proverOptions.useSimd).toBe(false);
      expect(options.witnessOptions.simd).toBe(false);
      expect(options.witnessOptions.memorySize).toBe(0);
    } finally {
      WebAssembly.validate = originalValidate;
      _resetSimdCacheForTests();
    }
  });

  it("enables SIMD options and logs telemetry when SIMD bytecode validation succeeds", async () => {
    const { _resetSimdCacheForTests } = await import("@/lib/zkp/wasmSimd");
    _resetSimdCacheForTests();

    const originalValidate = WebAssembly.validate;
    const consoleSpy = jest.spyOn(console, "info").mockImplementation(() => {});
    WebAssembly.validate = jest.fn().mockReturnValue(true);

    try {
      const isSupported = await isWasmSimdSupported();
      expect(isSupported).toBe(true);

      const options = await getOptimizedZkpOptions();
      expect(options.simdEnabled).toBe(true);
      expect(options.proverOptions.useSimd).toBe(true);
      expect(options.witnessOptions.simd).toBe(true);
      expect(options.witnessOptions.memorySize).toBe(16);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("SIMD (v128) enabled"),
      );
    } finally {
      WebAssembly.validate = originalValidate;
      consoleSpy.mockRestore();
      _resetSimdCacheForTests();
    }
  });
});
