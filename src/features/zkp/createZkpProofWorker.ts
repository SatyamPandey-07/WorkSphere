/**
 * Browser factory for zkpProofWorker. Kept in its own module because
 * `import.meta.url` worker URLs are bundler-specific and not loadable
 * under Jest; tests pass their own `createWorker` or mock this module instead.
 */
export function createZkpProofWorker(): Worker {
  return new Worker(
    new URL("../../workers/zkpProofWorker.ts", import.meta.url),
    { type: "module" },
  );
}

export default createZkpProofWorker;
