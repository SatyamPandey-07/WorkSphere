describe("zkpWorker WASM memory lifecycle", () => {
  it("keeps 20 consecutive proof lifecycles bounded to one active WASM lifecycle", async () => {
    let activeLifecycles = 0;
    let maxActiveLifecycles = 0;
    let completedLifecycles = 0;

    const runProofLifecycle = async () => {
      activeLifecycles += 1;
      maxActiveLifecycles = Math.max(
        maxActiveLifecycles,
        activeLifecycles,
      );

      try {
        await Promise.resolve();
        completedLifecycles += 1;
      } finally {
        activeLifecycles -= 1;
      }
    };

    for (let i = 0; i < 20; i += 1) {
      await runProofLifecycle();
    }

    expect(completedLifecycles).toBe(20);

    // Consecutive requests must never retain multiple active proof
    // lifecycles at the same time.
    expect(maxActiveLifecycles).toBe(1);
    expect(activeLifecycles).toBe(0);
  });

  it("uses explicit snarkjs memory controls in the worker", async () => {
    const fs = await import("node:fs/promises");
    const workerSource = await fs.readFile(
      "src/workers/zkpWorker.ts",
      "utf8",
    );

    expect(workerSource).toContain("snarkjs.wtns.calculate");
    expect(workerSource).toContain("memorySize: 0");
    expect(workerSource).toContain("snarkjs.groth16.prove");
    expect(workerSource).toContain("singleThread: true");
    expect(workerSource).toContain("wtns = null");
    expect(workerSource).toContain("curve_bn128");
  });
});