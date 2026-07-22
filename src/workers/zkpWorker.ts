import * as snarkjs from "snarkjs";

self.addEventListener("message", async (e) => {
  const { identityToken, expectedCommit } = e.data;

  try {
    // Generate proof
    // We assume the wasm and zkey are available in the public/zkp directory
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      { identityToken, expectedCommit },
      "/zkp/premium_membership.wasm",
      "/zkp/premium_membership.zkey",
    );

    self.postMessage({ type: "success", proof, publicSignals });
  } catch (error) {
    console.error("ZKP Proof Generation Error:", error);
    self.postMessage({ type: "error", error: (error as Error).message });
  }
});
