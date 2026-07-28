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

function sanitizeError(error: unknown): string {
  if (error instanceof Error && error.message) {
    if (
      error.message.includes("wasm") ||
      error.message.includes("memory") ||
      error.message.includes("ENOENT")
    ) {
      return "Proof generation failed due to an internal error.";
    }
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
    self.postMessage({ type: "error", error: sanitizeError(error) });
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
