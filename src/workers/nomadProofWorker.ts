import * as snarkjs from "snarkjs";
import type { NomadProverInput } from "@/lib/zkp/nomadProof";

interface ProveMessage {
  type: "prove";
  input: NomadProverInput;
}

const WORKER = self as unknown as DedicatedWorkerGlobalScope;

async function terminateCurve(): Promise<void> {
  const global = globalThis as typeof globalThis & {
    curve_bn128?: { terminate: () => Promise<void> };
  };

  if (!global.curve_bn128) return;

  try {
    await global.curve_bn128.terminate();
  } catch {
    // Cleanup must not hide the proof-generation result.
  } finally {
    delete global.curve_bn128;
  }
}

WORKER.onmessage = async (event: MessageEvent<ProveMessage>) => {
  if (event.data?.type !== "prove") {
    WORKER.postMessage({
      type: "error",
      error: "Unsupported Nomad worker request.",
    });
    return;
  }

  try {
    const input = event.data.input;

    const fields = Object.values(input);

    if (
      fields.length !== 7 ||
      !fields.every(
        (value) => typeof value === "string" && /^[0-9]+$/.test(value),
      )
    ) {
      throw new Error("Invalid Nomad witness inputs.");
    }

    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      input as unknown as Record<string, unknown>,
      "/zkp/nomad_productivity_proof.wasm",
      "/zkp/nomad_productivity_proof.zkey",
    );

    WORKER.postMessage({
      type: "success",
      proof,
      publicSignals,
    });
  } catch {
    WORKER.postMessage({
      type: "error",
      error: "Nomad Groth16 proof generation failed.",
    });
  } finally {
    await terminateCurve();
  }
};
