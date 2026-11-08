/**
 * @jest-environment node
 */
import fs from "fs";
import path from "path";
import {
  circuitSha256,
  findStaleArtifactProblems,
  parseZkeyHeader,
  EXPECTED_COMMITMENT_SCHEME,
  MIN_POSEIDON_WIRES,
  type ArtifactManifest,
} from "@/lib/zkp/artifactFreshness";

const ROOT = process.cwd();
const CIRCUIT_PATH = path.join(ROOT, "circuits", "premium_membership.circom");
const ZKEY_PATH = path.join(ROOT, "public", "zkp", "premium_membership.zkey");
const MANIFEST_PATH = path.join(ROOT, "public", "zkp", "artifacts.manifest.json");

/** Builds a minimal snarkjs-style .zkey containing only the sections we parse. */
function buildZkey(opts: {
  nVars: number;
  nPublic: number;
  domainSize?: number;
  magic?: string;
}): Buffer {
  const n8 = 32;
  const header = Buffer.alloc(4 + n8 + 4 + n8 + 12);
  let p = 0;
  header.writeUInt32LE(n8, p); p += 4 + n8; // q
  header.writeUInt32LE(n8, p); p += 4 + n8; // r
  header.writeUInt32LE(opts.nVars, p);
  header.writeUInt32LE(opts.nPublic, p + 4);
  header.writeUInt32LE(opts.domainSize ?? 8, p + 8);

  const protocol = Buffer.alloc(4);
  protocol.writeUInt32LE(1, 0); // groth16

  const file = Buffer.alloc(12 + 12 + protocol.length + 12 + header.length);
  file.write(opts.magic ?? "zkey", 0, "latin1");
  file.writeUInt32LE(1, 4); // version
  file.writeUInt32LE(2, 8); // section count
  let o = 12;
  file.writeUInt32LE(1, o); file.writeBigUInt64LE(BigInt(protocol.length), o + 4);
  protocol.copy(file, o + 12); o += 12 + protocol.length;
  file.writeUInt32LE(2, o); file.writeBigUInt64LE(BigInt(header.length), o + 4);
  header.copy(file, o + 12);
  return file;
}

function manifestFor(source: string, over: Partial<ArtifactManifest> = {}): ArtifactManifest {
  return {
    circuit: "premium_membership.circom",
    circuitSha256: circuitSha256(source),
    commitmentScheme: EXPECTED_COMMITMENT_SCHEME,
    circomlibVersion: "2.0.5",
    ...over,
  };
}

const SOURCE = 'pragma circom 2.0.0;\ninclude "circomlib/circuits/poseidon.circom";\n';

describe("parseZkeyHeader", () => {
  it("reads wire, public-signal and domain counts", () => {
    const h = parseZkeyHeader(buildZkey({ nVars: 300, nPublic: 1, domainSize: 512 }));
    expect(h).toEqual({ protocol: 1, nVars: 300, nPublic: 1, domainSize: 512 });
  });

  it("rejects files that are not zkeys", () => {
    expect(() => parseZkeyHeader(buildZkey({ nVars: 1, nPublic: 1, magic: "nope" }))).toThrow(/bad magic/);
    expect(() => parseZkeyHeader(Buffer.from("zk"))).toThrow();
  });
});

describe("circuitSha256", () => {
  it("is identical for LF and CRLF checkouts of the same source", () => {
    expect(circuitSha256(SOURCE)).toBe(circuitSha256(SOURCE.replace(/\n/g, "\r\n")));
  });

  it("changes when the circuit changes", () => {
    expect(circuitSha256(SOURCE)).not.toBe(circuitSha256(SOURCE + "// edit\n"));
  });
});

describe("findStaleArtifactProblems", () => {
  const freshHeader = parseZkeyHeader(buildZkey({ nVars: 300, nPublic: 1 }));

  it("accepts artifacts built from the current Poseidon circuit", () => {
    expect(
      findStaleArtifactProblems({ circuitSource: SOURCE, manifest: manifestFor(SOURCE), zkeyHeader: freshHeader }),
    ).toEqual([]);
  });

  it("flags the retired 4-wire polynomial circuit", () => {
    const stale = parseZkeyHeader(buildZkey({ nVars: 4, nPublic: 1 }));
    const problems = findStaleArtifactProblems({ circuitSource: SOURCE, manifest: manifestFor(SOURCE), zkeyHeader: stale });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/only 4 wires/);
    expect(problems[0]).toMatch(/compile-zkp\.sh/);
  });

  it(`treats fewer than ${MIN_POSEIDON_WIRES} wires as non-Poseidon`, () => {
    const edge = parseZkeyHeader(buildZkey({ nVars: MIN_POSEIDON_WIRES - 1, nPublic: 1 }));
    expect(findStaleArtifactProblems({ circuitSource: SOURCE, manifest: manifestFor(SOURCE), zkeyHeader: edge })).not.toEqual([]);
    const ok = parseZkeyHeader(buildZkey({ nVars: MIN_POSEIDON_WIRES, nPublic: 1 }));
    expect(findStaleArtifactProblems({ circuitSource: SOURCE, manifest: manifestFor(SOURCE), zkeyHeader: ok })).toEqual([]);
  });

  it("flags a circuit edited after the artifacts were built", () => {
    const problems = findStaleArtifactProblems({
      circuitSource: SOURCE + "// changed\n",
      manifest: manifestFor(SOURCE),
      zkeyHeader: freshHeader,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/changed after the artifacts were built/);
  });

  it("flags a missing manifest", () => {
    const problems = findStaleArtifactProblems({ circuitSource: SOURCE, manifest: null, zkeyHeader: freshHeader });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/artifacts\.manifest\.json is missing/);
  });

  it("flags a manifest recorded for a different commitment scheme", () => {
    const problems = findStaleArtifactProblems({
      circuitSource: SOURCE,
      manifest: manifestFor(SOURCE, { commitmentScheme: "polynomial" }),
      zkeyHeader: freshHeader,
    });
    expect(problems.join("\n")).toMatch(/polynomial/);
  });

  it("flags an unexpected number of public signals", () => {
    const two = parseZkeyHeader(buildZkey({ nVars: 300, nPublic: 2 }));
    const problems = findStaleArtifactProblems({ circuitSource: SOURCE, manifest: manifestFor(SOURCE), zkeyHeader: two });
    expect(problems.join("\n")).toMatch(/exactly 1/);
  });

  it("reports every problem at once", () => {
    const stale = parseZkeyHeader(buildZkey({ nVars: 4, nPublic: 1 }));
    expect(
      findStaleArtifactProblems({ circuitSource: SOURCE + "x", manifest: manifestFor(SOURCE, { commitmentScheme: "polynomial" }), zkeyHeader: stale }),
    ).toHaveLength(3);
  });
});

describe("committed ZKP artifacts", () => {
  it("were built from the committed premium_membership.circom", () => {
    const circuitSource = fs.readFileSync(CIRCUIT_PATH, "utf8");
    const zkeyHeader = parseZkeyHeader(fs.readFileSync(ZKEY_PATH));
    const manifest: ArtifactManifest | null = fs.existsSync(MANIFEST_PATH)
      ? JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"))
      : null;

    // On failure this prints exactly what is stale and how to rebuild.
    expect(findStaleArtifactProblems({ circuitSource, manifest, zkeyHeader })).toEqual([]);
  });
});
