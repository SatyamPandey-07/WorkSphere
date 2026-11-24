/**
 * Browser factory for the power telemetry worker (#9634).
 * Kept in its own module because `import.meta.url` worker URLs are bundler-specific
 * and not loadable under Jest CommonJS; callers and tests can pass `createWorker` to the loader.
 */

export function createPowerWorker(): Worker {
  return new Worker(
    new URL("../../workers/powerTelemetryWorker.ts", import.meta.url),
    {
      type: "module",
    },
  );
}
