import {
  AllEndpointsFailedError,
  SolanaClusterPool,
  type RpcTransport,
} from "../../../lib/solana/clusterRpcPool";

describe("SolanaClusterPool", () => {
  let currentTime: number;

  beforeEach(() => {
    currentTime = 1_000_000;
    jest.useFakeTimers();
    jest.setSystemTime(currentTime);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const advanceTime = async (ms: number) => {
    currentTime += ms;
    await jest.advanceTimersByTimeAsync(ms);
  };

  it("fails over deterministically when primary endpoints return 429 or 5xx errors", async () => {
    const calls: string[] = [];
    const transport: RpcTransport = async (endpoint, method) => {
      calls.push(`${endpoint}:${method}`);
      if (endpoint === "https://rpc-1.example.com") {
        throw Object.assign(new Error("Too Many Requests"), { status: 429 });
      }
      if (endpoint === "https://rpc-2.example.com") {
        throw Object.assign(new Error("Internal Server Error"), {
          status: 503,
        });
      }
      return { slot: 285_000_000 };
    };

    const pool = new SolanaClusterPool({
      endpoints: [
        "https://rpc-1.example.com",
        "https://rpc-2.example.com",
        "https://rpc-3.example.com",
      ],
      transport,
      now: () => currentTime,
    });

    const result = await pool.call<{ slot: number }>("getSlot", []);
    expect(result).toEqual({ slot: 285_000_000 });
    expect(calls).toEqual([
      "https://rpc-1.example.com:getSlot",
      "https://rpc-2.example.com:getSlot",
      "https://rpc-3.example.com:getSlot",
    ]);
  });

  it("times out hanging endpoints without hanging the pool or leaking unhandled rejections", async () => {
    const unhandledRejections: unknown[] = [];
    const onUnhandled = (reason: unknown) => {
      unhandledRejections.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    try {
      const transport: RpcTransport = async (
        endpoint,
        _method,
        _params,
        signal,
      ) => {
        if (endpoint === "https://slow-1.example.com") {
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () =>
              reject(new Error("aborted slow-1")),
            );
          });
        }
        if (endpoint === "https://slow-2.example.com") {
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () =>
              reject(new Error("aborted slow-2")),
            );
          });
        }
        return "ok-from-healthy";
      };

      const pool = new SolanaClusterPool({
        endpoints: [
          "https://slow-1.example.com",
          "https://slow-2.example.com",
          "https://fast-3.example.com",
        ],
        transport,
        requestTimeoutMs: 250,
        now: () => currentTime,
      });

      const callPromise = pool.call<string>("getLatestBlockhash", []);
      await advanceTime(250);
      const result = await callPromise;

      expect(result).toBe("ok-from-healthy");
      expect(unhandledRejections).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("opens circuit after failure threshold, skips endpoint during cooldown, and recovers on probe or success", async () => {
    let failPrimary = true;
    const calledEndpoints: string[] = [];

    const transport: RpcTransport = async (endpoint, method) => {
      calledEndpoints.push(`${endpoint}:${method}`);
      if (endpoint === "https://primary.example.com") {
        if (method === "getHealth") {
          return failPrimary ? Promise.reject(new Error("unhealthy")) : "ok";
        }
        if (failPrimary) {
          throw Object.assign(new Error("Gateway Timeout"), { status: 504 });
        }
        return "primary-data";
      }
      return "secondary-data";
    };

    const pool = new SolanaClusterPool({
      endpoints: [
        "https://primary.example.com",
        "https://secondary.example.com",
      ],
      transport,
      failureThreshold: 2,
      cooldownMs: 10_000,
      now: () => currentTime,
    });

    // Trip primary's circuit (2 consecutive 504s)
    await expect(pool.call("getBalance", ["addr1"])).resolves.toBe(
      "secondary-data",
    );
    await expect(pool.call("getBalance", ["addr2"])).resolves.toBe(
      "secondary-data",
    );

    const snapDuringCooldown = pool.getHealthSnapshot();
    const primarySnap = snapDuringCooldown.find(
      (s) => s.endpoint === "https://primary.example.com",
    );
    expect(primarySnap?.consecutiveFailures).toBe(2);
    expect(primarySnap?.circuitOpenUntil).toBe(currentTime + 10_000);

    // During cooldown, primary is deprioritized behind healthy secondary
    calledEndpoints.length = 0;
    await expect(pool.call("getBalance", ["addr3"])).resolves.toBe(
      "secondary-data",
    );
    expect(calledEndpoints[0]).toBe("https://secondary.example.com:getBalance");

    // Advance past cooldown and probe health after primary recovers
    failPrimary = false;
    await advanceTime(10_000);

    const probeResult = await pool.probeHealth();
    expect(probeResult["https://primary.example.com"]).toBe(true);

    const recoveredSnap = pool
      .getHealthSnapshot()
      .find((s) => s.endpoint === "https://primary.example.com");
    expect(recoveredSnap?.circuitOpenUntil).toBeNull();
    expect(recoveredSnap?.consecutiveFailures).toBe(0);
  });

  it("throws AllEndpointsFailedError when every endpoint fails", async () => {
    const transport: RpcTransport = async (endpoint) => {
      throw Object.assign(new Error(`down: ${endpoint}`), { status: 502 });
    };

    const pool = new SolanaClusterPool({
      endpoints: ["https://a.example.com", "https://b.example.com"],
      transport,
      now: () => currentTime,
    });

    await expect(pool.call("getSlot", [])).rejects.toBeInstanceOf(
      AllEndpointsFailedError,
    );
  });

  it("adds bounded cooldownJitterMs using deterministic random sampler and delays probe until jitter expires", async () => {
    let failPrimary = true;
    const transport: RpcTransport = async (endpoint, method) => {
      if (endpoint === "https://primary.example.com") {
        if (method === "getHealth") {
          return failPrimary ? Promise.reject(new Error("down")) : "ok";
        }
        if (failPrimary) {
          throw Object.assign(new Error("Service Unavailable"), {
            status: 503,
          });
        }
        return "primary-ok";
      }
      return "secondary-ok";
    };

    const pool = new SolanaClusterPool({
      endpoints: [
        "https://primary.example.com",
        "https://secondary.example.com",
      ],
      transport,
      failureThreshold: 1,
      cooldownMs: 10_000,
      cooldownJitterMs: 4_000,
      random: () => 0.5,
      now: () => currentTime,
    });

    await expect(pool.call("getSlot", [])).resolves.toBe("secondary-ok");

    const snap = pool
      .getHealthSnapshot()
      .find((s) => s.endpoint === "https://primary.example.com");
    expect(snap?.circuitOpenUntil).toBe(currentTime + 12_000);

    // At base cooldown (10s), circuit must still be open due to +2s jitter
    failPrimary = false;
    await advanceTime(10_000);
    const probeBeforeJitter = await pool.probeHealth();
    expect(probeBeforeJitter["https://primary.example.com"]).toBe(false);

    // Once full cooldown + jitter (12s total) elapses, endpoint recovers via probe
    await advanceTime(2_000);
    const probeAfterJitter = await pool.probeHealth();
    expect(probeAfterJitter["https://primary.example.com"]).toBe(true);
  });

  it("computes deterministic staggered cooldowns when cooldownJitterSeed is provided", async () => {
    const createSeededPool = (seed: number) =>
      new SolanaClusterPool({
        endpoints: [
          "https://rpc-1.example.com",
          "https://rpc-2.example.com",
          "https://rpc-3.example.com",
        ],
        transport: async (endpoint) => {
          if (endpoint !== "https://rpc-3.example.com") {
            throw Object.assign(new Error("429"), { status: 429 });
          }
          return "ok";
        },
        failureThreshold: 1,
        cooldownMs: 10_000,
        cooldownJitterMs: 5_000,
        cooldownJitterSeed: seed,
        now: () => currentTime,
      });

    const poolA = createSeededPool(42);
    const poolB = createSeededPool(42);

    await poolA.call("getSlot", []);
    await poolB.call("getSlot", []);

    const snapA = poolA.getHealthSnapshot();
    const snapB = poolB.getHealthSnapshot();

    expect(snapA[0].circuitOpenUntil).toBe(snapB[0].circuitOpenUntil);
    expect(snapA[1].circuitOpenUntil).toBe(snapB[1].circuitOpenUntil);
    expect(snapA[0].circuitOpenUntil).toBeGreaterThanOrEqual(
      currentTime + 10_000,
    );
    expect(snapA[0].circuitOpenUntil).toBeLessThanOrEqual(
      currentTime + 15_000,
    );
    expect(snapA[0].circuitOpenUntil).not.toBe(snapA[1].circuitOpenUntil);
  });

  it("clamps invalid or negative cooldownJitterMs and out-of-range random samples safely", async () => {
    const failingTransport: RpcTransport = async (endpoint) => {
      if (endpoint === "https://rpc-1.example.com") {
        throw Object.assign(new Error("502"), { status: 502 });
      }
      return "ok";
    };

    const negativeJitterPool = new SolanaClusterPool({
      endpoints: ["https://rpc-1.example.com", "https://rpc-2.example.com"],
      transport: failingTransport,
      failureThreshold: 1,
      cooldownMs: 8_000,
      cooldownJitterMs: -500,
      random: () => 0.9,
      now: () => currentTime,
    });
    await negativeJitterPool.call("getSlot", []);
    expect(negativeJitterPool.getHealthSnapshot()[0].circuitOpenUntil).toBe(
      currentTime + 8_000,
    );

    const clampedUpperPool = new SolanaClusterPool({
      endpoints: ["https://rpc-1.example.com", "https://rpc-2.example.com"],
      transport: failingTransport,
      failureThreshold: 1,
      cooldownMs: 8_000,
      cooldownJitterMs: 2_000,
      random: () => 5,
      now: () => currentTime,
    });
    await clampedUpperPool.call("getSlot", []);
    expect(clampedUpperPool.getHealthSnapshot()[0].circuitOpenUntil).toBe(
      currentTime + 10_000,
    );
  });
});
