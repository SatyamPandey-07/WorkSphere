/**
 * Browser factory for the ECDSA verify worker (#5526).
 * Follows the pattern established in createAcousticWorker.ts.
 */

export function createEcdsaWorker(): Worker {
  return new Worker(new URL("../../workers/ecdsaVerifyWorker.ts", import.meta.url), {
    type: "module",
  });
}
