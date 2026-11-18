import { DistributedBloomLimiter } from "../src/lib/edge/DistributedBloomLimiter.ts";

const ITERATIONS = 100_000;
const LATENCY_MS = {
  "region-a": 20,
  "region-b": 80,
  "region-c": 120,
};

class BenchmarkNetwork {
  constructor() {
    this.listeners = new Map();
  }

  subscribe(region, listener) {
    let listeners = this.listeners.get(region);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(region, listeners);
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  publish(sourceRegion, state) {
    for (const [targetRegion, listeners] of this.listeners) {
      if (targetRegion === sourceRegion) continue;
      setTimeout(() => {
        for (const listener of listeners) {
          listener(state.slice(0));
        }
      }, LATENCY_MS[targetRegion] ?? 0);
    }
  }
}

function percentile(samples, percentileValue) {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.ceil(percentileValue * sorted.length) - 1,
  );
  return sorted[index];
}

const network = new BenchmarkNetwork();
const pubSubFor = (region) => ({
  publish: (state) => network.publish(region, state),
  subscribe: (listener) => network.subscribe(region, listener),
});

const nodes = [
  new DistributedBloomLimiter({
    thresholdCount: 100_000,
    replicaId: "region-a",
    pubSub: pubSubFor("region-a"),
    syncIntervalMs: 5,
  }),
  new DistributedBloomLimiter({
    thresholdCount: 100_000,
    replicaId: "region-b",
    pubSub: pubSubFor("region-b"),
    syncIntervalMs: 5,
  }),
  new DistributedBloomLimiter({
    thresholdCount: 100_000,
    replicaId: "region-c",
    pubSub: pubSubFor("region-c"),
    syncIntervalMs: 5,
  }),
];

for (const node of nodes) node.startSync();

const checkSamplesUs = [];
for (let i = 0; i < ITERATIONS; i++) {
  const started = performance.now();
  nodes[i % nodes.length].checkAndIncrement(`203.0.113.${i % 250}`);
  checkSamplesUs.push((performance.now() - started) * 1000);

  if (i > 0 && i % 1000 === 0) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

const averageCheckUs =
  checkSamplesUs.reduce((sum, value) => sum + value, 0) / checkSamplesUs.length;
const p95CheckUs = percentile(checkSamplesUs, 0.95);

for (let i = 0; i < 60; i++) {
  nodes[i % nodes.length].checkAndIncrement("198.51.100.25");
}

const convergenceStarted = performance.now();
await Promise.all(nodes.map((node) => node.syncGossipState()));
let convergenceMs = performance.now() - convergenceStarted;
let converged = false;
while (convergenceMs <= 500) {
  const syncStates = nodes.map((node) => Array.from(node.exportState()));
  converged = syncStates.every(
    (state) =>
      state.length === syncStates[0].length &&
      state.every((value, index) => value === syncStates[0][index]),
  );
  if (converged) break;
  await new Promise((resolve) => setTimeout(resolve, 10));
  convergenceMs = performance.now() - convergenceStarted;
}

for (const node of nodes) node.stopSync();

console.log(
  JSON.stringify(
    {
      synchronizationActiveDuringChecks: true,
      localCheckAverageUs: Number(averageCheckUs.toFixed(3)),
      localCheckP95Us: Number(p95CheckUs.toFixed(3)),
      synchronizationConvergenceMs: Number(convergenceMs.toFixed(3)),
      simulatedRegionLatenciesMs: LATENCY_MS,
      converged,
      acceptance:
        averageCheckUs < 1000 && p95CheckUs < 1000
          ? "local-check-sub-millisecond"
          : "local-check-review-required",
      convergenceAcceptance:
        converged && convergenceMs <= 500
          ? "converged-within-500ms"
          : "convergence-review-required",
    },
    null,
    2,
  ),
);
