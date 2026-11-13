/**
 * Creates the CPU fallback worker. Kept in its own module because
 * `import.meta.url` is only valid under the bundler, not under Jest (CommonJS).
 * The simulator loads this file lazily and only when a Worker is available.
 */
export function createAcousticCpuWorker(): Worker {
  return new Worker(new URL("./acousticCpuWorker.ts", import.meta.url), {
    type: "module",
  });
}
