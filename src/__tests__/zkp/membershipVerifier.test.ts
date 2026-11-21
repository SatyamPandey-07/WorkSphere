import {
  MEMBERSHIP_TREE_DEPTH,
  MembershipMerkleTree,
  computeMembershipAccessCommitment,
  computeMembershipLeaf,
  getMembershipRootPolicy,
  isMembershipEpochFresh,
  isMembershipRootActive,
  parseMembershipPublicSignals,
  parseMembershipRoots,
  validateMembershipProofInput,
  verifyMembershipPath,
} from "@/lib/zkp/membershipCircuit";
import {
  evaluateMembershipProof,
  type MembershipVerificationDecision,
} from "@/lib/zkp/membershipVerification";

const SECRET = 424242424242n;
const EPOCH = 1_760_000_000; // unix seconds
const NOW = { nowSeconds: () => EPOCH + 60 };

function buildTree(secret = SECRET, epoch = EPOCH) {
  const tree = new MembershipMerkleTree();
  for (let i = 0; i < 8; i++) tree.insertMember(1000n + BigInt(i), BigInt(epoch));
  const index = tree.insertMember(secret, BigInt(epoch));
  return { tree, proof: tree.getProof(index) };
}

const { proof: merkleProof } = buildTree();
const ROOT = merkleProof.root.toString();

const validProof = {
  pi_a: ["1", "2", "1"],
  pi_b: [
    ["1", "2"],
    ["3", "4"],
    ["1", "0"],
  ],
  pi_c: ["5", "6", "1"],
  protocol: "groth16",
  curve: "bn128",
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    ...NOW,
    roots: [{ root: ROOT }],
    loadVerificationKey: async () => ({ mock: "vkey" }),
    verifyProof: async () => true,
    ...overrides,
  };
}

async function decide(
  payload: unknown,
  overrides: Record<string, unknown> = {},
): Promise<MembershipVerificationDecision> {
  return evaluateMembershipProof(payload as never, dependencies(overrides));
}

describe("membership circuit helpers", () => {
  it("computes Poseidon(secret, epoch) leaves deterministically", () => {
    expect(computeMembershipLeaf(SECRET, EPOCH).toString()).toBe(
      computeMembershipLeaf(SECRET.toString(), String(EPOCH)).toString(),
    );
  });

  it("builds a depth-16 path that satisfies the circuit relation", () => {
    expect(merkleProof.pathElements).toHaveLength(MEMBERSHIP_TREE_DEPTH);
    expect(merkleProof.pathIndices).toHaveLength(MEMBERSHIP_TREE_DEPTH);
    expect(
      verifyMembershipPath(
        ROOT,
        SECRET,
        EPOCH,
        merkleProof.pathElements,
        merkleProof.pathIndices,
      ),
    ).toBe(true);
  });

  it("rejects a path when the epoch (and therefore the leaf) changes", () => {
    expect(
      verifyMembershipPath(
        merkleProof.root,
        SECRET,
        EPOCH + 1,
        merkleProof.pathElements,
        merkleProof.pathIndices,
      ),
    ).toBe(false);
  });

  it("rejects a path when a sibling is tampered", () => {
    const siblings = [...merkleProof.pathElements];
    siblings[3] = siblings[3] + 1n;
    expect(
      verifyMembershipPath(
        merkleProof.root,
        SECRET,
        EPOCH,
        siblings,
        merkleProof.pathIndices,
      ),
    ).toBe(false);
  });

  it("rejects non-boolean path indices", () => {
    const indices = [...merkleProof.pathIndices];
    indices[0] = 2;
    expect(
      verifyMembershipPath(
        merkleProof.root,
        SECRET,
        EPOCH,
        merkleProof.pathElements,
        indices,
      ),
    ).toBe(false);
  });

  it("produces an unlinkable access commitment from root and epoch", () => {
    const commitment = computeMembershipAccessCommitment(ROOT, EPOCH);
    expect(commitment).toMatch(/^\d+$/);
    expect(commitment).not.toContain(SECRET.toString());
  });
});

describe("membership input validation", () => {
  const base = {
    identitySecret: SECRET.toString(),
    epoch: String(EPOCH),
    root: ROOT,
    pathElements: merkleProof.pathElements.map(String),
    pathIndices: merkleProof.pathIndices.map(String),
  };

  it("accepts a well-formed witness", () => {
    const result = validateMembershipProofInput(base);
    expect(result.valid).toBe(true);
    expect(result.value?.epoch).toBe(String(EPOCH));
  });

  it("normalizes millisecond epochs to seconds", () => {
    const result = validateMembershipProofInput({ ...base, epoch: EPOCH * 1000 });
    expect(result.valid).toBe(true);
    expect(result.value?.epoch).toBe(String(EPOCH));
  });

  it("rejects a zero identity secret", () => {
    expect(validateMembershipProofInput({ ...base, identitySecret: "0" }).valid).toBe(false);
  });

  it("rejects wrong path lengths", () => {
    expect(
      validateMembershipProofInput({ ...base, pathElements: base.pathElements.slice(1) }).valid,
    ).toBe(false);
    expect(
      validateMembershipProofInput({ ...base, pathIndices: base.pathIndices.slice(1) }).valid,
    ).toBe(false);
  });

  it("rejects non-bit path indices", () => {
    const indices = [...base.pathIndices];
    indices[0] = "2";
    expect(validateMembershipProofInput({ ...base, pathIndices: indices }).valid).toBe(false);
  });
});

describe("membership public signals", () => {
  it("parses [root, epoch]", () => {
    const result = parseMembershipPublicSignals([ROOT, String(EPOCH)]);
    expect(result.valid).toBe(true);
    expect(result.value?.root).toBe(ROOT);
    expect(result.value?.epoch).toBe(EPOCH);
  });

  it("rejects wrong arity", () => {
    expect(parseMembershipPublicSignals([ROOT]).valid).toBe(false);
    expect(parseMembershipPublicSignals([ROOT, String(EPOCH), "1"]).valid).toBe(false);
  });

  it("rejects a non-numeric root", () => {
    expect(parseMembershipPublicSignals(["not-a-root", String(EPOCH)]).valid).toBe(false);
  });
});

describe("epoch freshness", () => {
  const now = 1_770_000_000;

  it("accepts a recent epoch", () => {
    expect(isMembershipEpochFresh(now - 3_600, { nowSeconds: now })).toBe(true);
  });

  it("rejects an expired epoch", () => {
    expect(isMembershipEpochFresh(now - 40 * 24 * 3_600, { nowSeconds: now })).toBe(false);
  });

  it("rejects a far-future epoch", () => {
    expect(isMembershipEpochFresh(now + 3_600, { nowSeconds: now })).toBe(false);
  });

  it("tolerates small clock skew", () => {
    expect(isMembershipEpochFresh(now + 60, { nowSeconds: now })).toBe(true);
  });

  it("rejects non-positive epochs", () => {
    expect(isMembershipEpochFresh(0, { nowSeconds: now })).toBe(false);
  });
});

describe("membership root registry", () => {
  it("parses plain and epoch-scoped roots", () => {
    const entries = parseMembershipRoots(`${ROOT}:${EPOCH},123;456:${EPOCH}`);
    expect(entries).toEqual([
      { root: ROOT, epoch: EPOCH },
      { root: "123" },
      { root: "456", epoch: EPOCH },
    ]);
  });

  it("reports explicit, dev-open and locked policies", () => {
    expect(getMembershipRootPolicy([{ root: ROOT }], "production")).toBe("explicit");
    expect(getMembershipRootPolicy([], "production")).toBe("locked");
    expect(getMembershipRootPolicy([], "development")).toBe("dev-open");
    expect(getMembershipRootPolicy([], "test")).toBe("dev-open");
  });

  it("only accepts the configured root for the configured epoch", () => {
    const entries = [{ root: ROOT, epoch: EPOCH }];
    expect(isMembershipRootActive(ROOT, EPOCH, entries)).toBe(true);
    expect(isMembershipRootActive(ROOT, EPOCH + 1, entries)).toBe(false);
    expect(isMembershipRootActive("789", EPOCH, entries)).toBe(false);
  });

  it("accepts any well-formed root when a root entry has no epoch", () => {
    expect(isMembershipRootActive(ROOT, EPOCH, [{ root: ROOT }])).toBe(true);
  });
});

describe("evaluateMembershipProof", () => {
  const validPayload = {
    proof: validProof,
    publicSignals: [ROOT, String(EPOCH)],
  };

  it("accepts a valid proof for an active root and fresh epoch", async () => {
    const decision = await decide(validPayload);
    expect(decision).toMatchObject({
      ok: true,
      status: 200,
      root: ROOT,
      epoch: EPOCH,
      commitment: computeMembershipAccessCommitment(ROOT, EPOCH),
    });
  });

  it("rejects a malformed proof with 401", async () => {
    const decision = await decide({ proof: { pi_a: [] }, publicSignals: [] });
    expect(decision).toMatchObject({ ok: false, status: 401, code: "MALFORMED_PROOF" });
  });

  it("rejects an expired proof with 401 before calling the verifier", async () => {
    const verifyProof = jest.fn(async () => true);
    const decision = await decide(
      { proof: validProof, publicSignals: [ROOT, String(EPOCH)] },
      { nowSeconds: () => EPOCH + 40 * 24 * 3_600, verifyProof },
    );
    expect(decision).toMatchObject({ ok: false, status: 401, code: "EXPIRED_EPOCH" });
    expect(verifyProof).not.toHaveBeenCalled();
  });

  it("rejects an inactive Merkle root with 401", async () => {
    const decision = await decide(validPayload, { roots: [{ root: "987654321" }] });
    expect(decision).toMatchObject({ ok: false, status: 401, code: "INACTIVE_ROOT" });
  });

  it("rejects a cryptographically invalid proof with 401", async () => {
    const decision = await decide(validPayload, { verifyProof: async () => false });
    expect(decision).toMatchObject({ ok: false, status: 401, code: "INVALID_PROOF" });
  });

  it("rejects a proof whose verifier throws with 401", async () => {
    const decision = await decide(validPayload, {
      verifyProof: async () => {
        throw new Error("bad pairing");
      },
    });
    expect(decision).toMatchObject({ ok: false, status: 401, code: "INVALID_PROOF" });
  });

  it("returns 500 only when the verification key is unavailable", async () => {
    const decision = await decide(validPayload, {
      loadVerificationKey: async () => {
        throw new Error("ENOENT");
      },
    });
    expect(decision).toMatchObject({ ok: false, status: 500, code: "VERIFIER_UNAVAILABLE" });
  });

  it("reports verification latency", async () => {
    const decision = await decide(validPayload);
    expect(decision.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
