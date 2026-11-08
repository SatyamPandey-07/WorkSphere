/**
 * Detects ZKP proving artifacts (public/zkp/*) that were built from a different
 * circuit than the one committed in circuits/premium_membership.circom.
 *
 * Why this exists: the circuit, the compiled wasm/zkey/verification key, and the
 * TypeScript commitment (commitment.ts) must all describe the same relation. They
 * are three separately-edited artifacts, and CI never recompiles the circuit, so
 * changing one without the others silently breaks every proof (the witness
 * becomes unsatisfiable) while still type-checking and building cleanly.
 *
 * `scripts/compile-zkp.sh` writes public/zkp/artifacts.manifest.json; this module
 * compares it (and the zkey's own header) against the circuit source.
 *
 * Node-only (uses `crypto`). Import from tests and scripts, never from client code.
 */

import crypto from "crypto";

export interface ArtifactManifest {
  circuit: string;
  circuitSha256: string;
  commitmentScheme: string;
  circomlibVersion: string;
}

export interface ZkeyHeader {
  protocol: number;
  nVars: number;
  nPublic: number;
  domainSize: number;
}

/** The commitment scheme circuits/premium_membership.circom currently implements. */
export const EXPECTED_COMMITMENT_SCHEME = "poseidon-bn254";

/**
 * Circom Poseidon(1) alone allocates well over a hundred wires (every S-box adds
 * intermediate signals across 8 full + 56 partial rounds). The retired
 * polynomial circuit had exactly 4. Anything under this threshold cannot be a
 * Poseidon circuit.
 */
export const MIN_POSEIDON_WIRES = 100;

/** SHA-256 of circuit source with line endings normalized (CRLF checkouts hash the same). */
export function circuitSha256(source: string): string {
  return crypto
    .createHash("sha256")
    .update(source.replace(/\r\n/g, "\n"))
    .digest("hex");
}

/** Reads the Groth16 header section of a snarkjs .zkey file. */
export function parseZkeyHeader(buf: Uint8Array): ZkeyHeader {
  const b = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (b.length < 12 || b.toString("latin1", 0, 4) !== "zkey") {
    throw new Error("Not a snarkjs .zkey file (bad magic)");
  }

  const sectionCount = b.readUInt32LE(8);
  let pos = 12;
  let protocol: number | undefined;
  let headerPos: number | undefined;

  for (let i = 0; i < sectionCount; i++) {
    if (pos + 12 > b.length) throw new Error("Truncated .zkey section table");
    const type = b.readUInt32LE(pos);
    const length = Number(b.readBigUInt64LE(pos + 4));
    const dataPos = pos + 12;
    if (type === 1 && protocol === undefined) protocol = b.readUInt32LE(dataPos);
    if (type === 2 && headerPos === undefined) headerPos = dataPos;
    pos = dataPos + length;
  }

  if (protocol === undefined || headerPos === undefined) {
    throw new Error("Missing Groth16 header section in .zkey");
  }

  let p = headerPos;
  const n8q = b.readUInt32LE(p);
  p += 4 + n8q;
  const n8r = b.readUInt32LE(p);
  p += 4 + n8r;

  return {
    protocol,
    nVars: b.readUInt32LE(p),
    nPublic: b.readUInt32LE(p + 4),
    domainSize: b.readUInt32LE(p + 8),
  };
}

export interface FreshnessInput {
  circuitSource: string;
  manifest: ArtifactManifest | null;
  zkeyHeader: ZkeyHeader;
}

const REBUILD_HINT =
  "Rebuild with `bash scripts/compile-zkp.sh` and commit public/zkp/*.";

/** Returns human-readable problems; an empty array means the artifacts are fresh. */
export function findStaleArtifactProblems(input: FreshnessInput): string[] {
  const { circuitSource, manifest, zkeyHeader } = input;
  const problems: string[] = [];

  if (zkeyHeader.nVars < MIN_POSEIDON_WIRES) {
    problems.push(
      `premium_membership.zkey has only ${zkeyHeader.nVars} wires, which is the ` +
        `retired t^2+5t+17 circuit, not Poseidon. ${REBUILD_HINT}`,
    );
  }

  if (zkeyHeader.nPublic !== 1) {
    problems.push(
      `premium_membership.zkey declares ${zkeyHeader.nPublic} public signals; ` +
        `the membership circuit exposes exactly 1 (expectedCommit).`,
    );
  }

  if (!manifest) {
    problems.push(
      `public/zkp/artifacts.manifest.json is missing, so the artifacts cannot be ` +
        `tied to the circuit. ${REBUILD_HINT}`,
    );
    return problems;
  }

  if (manifest.commitmentScheme !== EXPECTED_COMMITMENT_SCHEME) {
    problems.push(
      `Manifest commitment scheme is "${manifest.commitmentScheme}" but the ` +
        `circuit/TypeScript use "${EXPECTED_COMMITMENT_SCHEME}". ${REBUILD_HINT}`,
    );
  }

  const actual = circuitSha256(circuitSource);
  if (manifest.circuitSha256 !== actual) {
    problems.push(
      `circuits/premium_membership.circom changed after the artifacts were built ` +
        `(manifest ${manifest.circuitSha256.slice(0, 12)}… vs source ` +
        `${actual.slice(0, 12)}…). ${REBUILD_HINT}`,
    );
  }

  return problems;
}
