/**
 * Browser factory for zkpWorker. Kept in its own module because
 * `import.meta.url` worker URLs are bundler-specific and not loadable
 * under Jest (CommonJS); StudentDiscountVerification loads it lazily
 * and tests can mock this module cleanly.
 */
export function createZkpWorker(): Worker {
  return new Worker(new URL("../../workers/zkpWorker.ts", import.meta.url));
}
