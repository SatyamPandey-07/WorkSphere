import {
  initPowerWasm,
  analyzePowerDraw,
  resetStats,
  _resetWasmForTesting,
  _setCustomWasmInstanceForTesting,
} from "@/lib/wasm-loader/power";

describe("Issue #9519 - Power Anomaly Detection Runtime & Statistical Window", () => {
  beforeEach(async () => {
    _resetWasmForTesting();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    await initPowerWasm();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("validates input measurements and rejects negative or non-finite numbers", () => {
    expect(() => analyzePowerDraw(-10)).toThrow(
      "Invalid power draw reading: must be a non-negative finite number.",
    );
    expect(() => analyzePowerDraw(NaN)).toThrow(
      "Invalid power draw reading: must be a non-negative finite number.",
    );
    expect(() => analyzePowerDraw(Infinity)).toThrow(
      "Invalid power draw reading: must be a non-negative finite number.",
    );
    expect(() => analyzePowerDraw("50" as any)).toThrow(
      "Invalid power draw reading: must be a non-negative finite number.",
    );
  });

  it("returns INSUFFICIENT_DATA for the first 4 samples while accumulating history", () => {
    resetStats();

    const r1 = analyzePowerDraw(50);
    expect(r1.status).toBe("INSUFFICIENT_DATA");
    expect(r1.movingAverage).toBe(50);

    const r2 = analyzePowerDraw(52);
    expect(r2.status).toBe("INSUFFICIENT_DATA");

    const r3 = analyzePowerDraw(48);
    expect(r3.status).toBe("INSUFFICIENT_DATA");

    const r4 = analyzePowerDraw(50);
    expect(r4.status).toBe("INSUFFICIENT_DATA");
  });

  it("classifies steady power readings as NORMAL with accurate rolling moving average", () => {
    resetStats();

    // Feed 10 steady readings around 100W
    const readings = [100, 101, 99, 100, 102, 98, 100, 101, 99, 100];
    let lastResult: any;

    for (const draw of readings) {
      lastResult = analyzePowerDraw(draw);
    }

    expect(lastResult.status).toBe("NORMAL");
    expect(lastResult.movingAverage).toBeCloseTo(100, 0);
  });

  it("detects sudden power SPIKE when reading significantly exceeds moving mean (z-score > 2.5)", () => {
    resetStats();

    // Establish stable 50W baseline with 10 samples
    for (let i = 0; i < 10; i++) {
      analyzePowerDraw(50 + (i % 2 === 0 ? 1 : -1));
    }

    // Sudden massive overload spike to 250W
    const spikeResult = analyzePowerDraw(250);
    expect(spikeResult.status).toBe("SPIKE");
    expect(spikeResult.rawDraw).toBe(250);
  });

  it("detects sudden power DROP when reading drops significantly below moving mean", () => {
    resetStats();

    // Establish stable 100W baseline with 12 samples
    for (let i = 0; i < 12; i++) {
      analyzePowerDraw(100 + (i % 2 === 0 ? 1 : -1));
    }

    // Sudden drop / disconnect to 2W
    const dropResult = analyzePowerDraw(2);
    expect(dropResult.status).toBe("DROP");
    expect(dropResult.rawDraw).toBe(2);
  });

  it("resets statistics cleanly via resetStats()", () => {
    // Accumulate history
    for (let i = 0; i < 8; i++) {
      analyzePowerDraw(60);
    }

    resetStats();

    // Next reading must revert to INSUFFICIENT_DATA because window was cleared
    const postReset = analyzePowerDraw(60);
    expect(postReset.status).toBe("INSUFFICIENT_DATA");
  });

  it("supports custom WASM exports module interface", async () => {
    _resetWasmForTesting();

    const mockWasmInstance = {
      _init_stats: jest.fn(),
      _analyze_power_draw: jest.fn().mockReturnValue(1), // mock SPIKE return
      _get_moving_average: jest.fn().mockReturnValue(75.25),
      _get_sample_count: jest.fn().mockReturnValue(8),
    };

    _setCustomWasmInstanceForTesting(mockWasmInstance);
    await initPowerWasm();

    const result = analyzePowerDraw(80);
    expect(mockWasmInstance._analyze_power_draw).toHaveBeenCalledWith(80);
    expect(result.status).toBe("SPIKE");
    expect(result.movingAverage).toBe(75.25);
  });
});
