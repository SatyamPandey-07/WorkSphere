import * as snarkjs from "snarkjs";

interface ProofRequest {
  type: "prove";
  identityToken: string;
  expectedCommit: string;
}

interface CancelMessage {
  type: "cancel";
}

type WorkerMessage = ProofRequest | CancelMessage;

let generation = 0;

type WorkerErrorType = "oom" | "internal" | "generic";

function classifyError(error: unknown): WorkerErrorType {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Out-of-memory signals from WASM runtime or browser
    if (
      msg.includes("out of memory") ||
      msg.includes("memory access out of bounds") ||
      msg.includes("allocation failed") ||
      msg.includes("cannot allocate") ||
      (error instanceof RangeError && msg.includes("memory"))
    ) {
      return "oom";
    }
    if (msg.includes("wasm") || msg.includes("enoent") || msg.includes("instantiate")) {
      return "internal";
    }
  }
  return "generic";
}

function sanitizeError(error: unknown): string {
  const type = classifyError(error);
  if (type === "oom") {
    return "Your device does not have enough memory to generate the zero-knowledge proof. Please try again on a device with more RAM, or use the server-side verification option.";
  }
  if (type === "internal") {
    return "Proof generation failed due to an internal error.";
  }
  return "Proof generation failed.";
}

self.addEventListener("message", async (e: MessageEvent<WorkerMessage>) => {
  if (e.data.type === "cancel") {
    generation++;
    return;
  }

  if (e.data.type !== "prove") return;

  const myGeneration = ++generation;
  const { identityToken, expectedCommit } = e.data;

  if (
    typeof identityToken !== "string" ||
    !/^-?\d+$/.test(identityToken)
  ) {
    self.postMessage({ type: "error", error: "Invalid identity token." });
    return;
  }

  if (
    typeof expectedCommit !== "string" ||
    !/^-?\d+$/.test(expectedCommit)
  ) {
    self.postMessage({ type: "error", error: "Invalid commitment value." });
    return;
  }

  try {
    self.postMessage({ type: "progress", stage: "generating" });

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      { identityToken, expectedCommit },
      "/zkp/premium_membership.wasm",
      "/zkp/premium_membership.zkey",
    );

    if (myGeneration !== generation) return;

    self.postMessage({ type: "success", proof, publicSignals });
  } catch (error) {
    if (myGeneration !== generation) return;
    const errorType = classifyError(error);
    self.postMessage({
      type: "error",
      error: sanitizeError(error),
      // Signal OOM separately so the component can offer server-side fallback
      isOom: errorType === "oom",
    });
  } finally {
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
  }
});
