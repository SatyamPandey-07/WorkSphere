import * as snarkjs from "snarkjs";

interface ProofRequest {
  identityToken: string;
  expectedCommit: string;
}

interface CancelMessage {
  type: "cancel";
}

type WorkerMessage = ProofRequest | CancelMessage;

let activeAbort = false;

self.addEventListener("message", async (e: MessageEvent<WorkerMessage>) => {
  if ("type" in e.data && e.data.type === "cancel") {
    activeAbort = true;
    return;
  }

  const { identityToken, expectedCommit } = e.data as ProofRequest;
  activeAbort = false;

  let blobUrls: string[] = [];

  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      { identityToken, expectedCommit },
      "/zkp/premium_membership.wasm",
      "/zkp/premium_membership.zkey",
    );

    if (activeAbort) return;

    self.postMessage({ type: "success", proof, publicSignals });
  } catch (error) {
    if (activeAbort) return;
    self.postMessage({ type: "error", error: (error as Error).message });
  } finally {
    // Release BN128 curve worker threads held by snarkjs
    const g = globalThis as typeof globalThis & {
      curve_bn128?: { terminate: () => Promise<void> };
    };
    if (g.curve_bn128) {
      try {
        await g.curve_bn128.terminate();
      } catch {
        // ignore cleanup errors
      }
    }

    // Revoke any blob object URLs created by snarkjs WASM loading
    for (const url of blobUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
    blobUrls = [];
  }
});
