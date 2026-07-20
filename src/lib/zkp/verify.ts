import path from "path";
import { computeMembershipCommit } from "./commitment";

export type ZkProofPayload = {
  proof: {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
    curve: string;
  };
  publicSignals: string[];
};

function artifactPaths() {
  const root = path.join(process.cwd(), "public", "zkp");
  return {
    wasm: path.join(root, "premium_membership.wasm"),
    zkey: path.join(root, "premium_membership.zkey"),
    vkey: path.join(root, "verification_key.json"),
  };
}

function loadSnarkjsNode() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("snarkjs");
}

async function releaseCurve() {
  const g = globalThis as typeof globalThis & {
    curve_bn128?: { terminate: () => Promise<void> };
  };
  if (g.curve_bn128) {
    try {
      await g.curve_bn128.terminate();
    } catch {
      // ignore
    }
  }
}

/** Node: build a groth16 proof for a private identity token. */
export async function proveMembership(
  identityToken: string | number | bigint,
): Promise<ZkProofPayload & { ms: number }> {
  const snarkjs = loadSnarkjsNode();
  const expectedCommit = computeMembershipCommit(identityToken);
  const { wasm, zkey } = artifactPaths();

  const started = Date.now();
  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      {
        identityToken: identityToken.toString(),
        expectedCommit,
      },
      wasm,
      zkey,
    );
    return { proof, publicSignals, ms: Date.now() - started };
  } finally {
    await releaseCurve();
  }
}

/** Server-only: verify a proof. Does not accept or store identity tokens. */
export async function verifyMembershipProof(
  proof: ZkProofPayload["proof"],
  publicSignals: string[],
): Promise<boolean> {
  const snarkjs = loadSnarkjsNode();
  const fs = await import("fs/promises");
  const vkeyRaw = await fs.readFile(artifactPaths().vkey, "utf8");
  const vkey = JSON.parse(vkeyRaw);
  try {
    return await snarkjs.groth16.verify(vkey, publicSignals, proof);
  } finally {
    await releaseCurve();
  }
}
