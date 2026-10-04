/**
 * @jest-environment node
 */
import {
  TREE_DEPTH,
  CURRENT_ACADEMIC_YEAR,
  computeStudentLeaf,
  getZeroHashes,
  StudentMembershipTree,
  verifyMerkleMembership,
  isUniversityMerkleRootActive,
  DEFAULT_ACTIVE_CAMPUS_ROOTS,
  verifyStudentMembershipProof,
} from "@/lib/zkp/studentMembership";
import { poseidonHash, BN254_SCALAR_FIELD } from "@/lib/zkp/poseidon";

describe("Student Zero-Knowledge Membership Proof Circuit (#3480)", () => {
  const secretA = 987654321n;
  const secretB = 123456789n;
  const secretC = 555666777n;
  const epoch = BigInt(CURRENT_ACADEMIC_YEAR);

  afterAll(async () => {
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
  });

  describe("Poseidon leaf commitment and tree structure", () => {
    it("computes deterministic student leaf commitment Poseidon(secret, epoch)", () => {
      const leaf1 = computeStudentLeaf(secretA, epoch);
      const leaf2 = computeStudentLeaf(secretA, epoch);

      expect(leaf1).toBe(leaf2);
      expect(leaf1).toBe(poseidonHash([secretA, epoch]));
      expect(leaf1).toBeGreaterThan(0n);
      expect(leaf1).toBeLessThan(BN254_SCALAR_FIELD);
    });

    it("generates correct depth-16 zero hashes", () => {
      const zeroHashes = getZeroHashes(TREE_DEPTH);
      expect(zeroHashes).toHaveLength(TREE_DEPTH + 1);
      expect(zeroHashes[0]).toBe(0n);
      expect(zeroHashes[1]).toBe(poseidonHash([0n, 0n]));
      expect(zeroHashes[2]).toBe(poseidonHash([zeroHashes[1], zeroHashes[1]]));
    });

    it("builds a depth-16 Merkle tree and generates membership proof", () => {
      const tree = new StudentMembershipTree(TREE_DEPTH);
      const indexA = tree.insertStudent(secretA, epoch);
      const indexB = tree.insertStudent(secretB, epoch);

      expect(indexA).toBe(0);
      expect(indexB).toBe(1);

      const root = tree.getRoot();
      expect(root).toBeGreaterThan(0n);

      const proofA = tree.getProof(indexA);
      expect(proofA.pathElements).toHaveLength(TREE_DEPTH);
      expect(proofA.pathIndices).toHaveLength(TREE_DEPTH);
      expect(proofA.root).toBe(root);
      expect(proofA.leaf).toBe(computeStudentLeaf(secretA, epoch));
    });
  });

  describe("Merkle membership path verification & root validation", () => {
    it("verifies valid membership proof matching the computed root", () => {
      const tree = new StudentMembershipTree(TREE_DEPTH);
      const index = tree.insertStudent(secretA, epoch);
      const root = tree.getRoot();
      const proof = tree.getProof(index);

      const isValid = verifyMerkleMembership(
        root,
        secretA,
        epoch,
        proof.pathElements,
        proof.pathIndices,
      );

      expect(isValid).toBe(true);
    });

    it("verifies multiple students enrolled in the same campus tree", () => {
      const tree = new StudentMembershipTree(TREE_DEPTH);
      const students = [secretA, secretB, secretC];
      const indices = students.map((s) => tree.insertStudent(s, epoch));
      const root = tree.getRoot();

      for (let i = 0; i < students.length; i++) {
        const proof = tree.getProof(indices[i]);
        const isValid = verifyMerkleMembership(
          root,
          students[i],
          epoch,
          proof.pathElements,
          proof.pathIndices,
        );
        expect(isValid).toBe(true);
      }
    });
  });

  describe("Rejection of forged paths and invalid credentials", () => {
    it("rejects forged path elements (tampered sibling hash)", () => {
      const tree = new StudentMembershipTree(TREE_DEPTH);
      const index = tree.insertStudent(secretA, epoch);
      const root = tree.getRoot();
      const proof = tree.getProof(index);

      // Tamper with sibling element at level 0
      const forgedElements = [...proof.pathElements];
      forgedElements[0] = 999999999n;

      const isValid = verifyMerkleMembership(
        root,
        secretA,
        epoch,
        forgedElements,
        proof.pathIndices,
      );

      expect(isValid).toBe(false);
    });

    it("rejects forged path indices (flipped position bit)", () => {
      const tree = new StudentMembershipTree(TREE_DEPTH);
      const index = tree.insertStudent(secretA, epoch);
      const root = tree.getRoot();
      const proof = tree.getProof(index);

      // Flip path index bit
      const forgedIndices = [...proof.pathIndices];
      forgedIndices[0] = forgedIndices[0] === 0 ? 1 : 0;

      const isValid = verifyMerkleMembership(
        root,
        secretA,
        epoch,
        proof.pathElements,
        forgedIndices,
      );

      expect(isValid).toBe(false);
    });

    it("rejects non-enrolled identity secret", () => {
      const tree = new StudentMembershipTree(TREE_DEPTH);
      const index = tree.insertStudent(secretA, epoch);
      const root = tree.getRoot();
      const proof = tree.getProof(index);

      const attackerSecret = 111222333n;

      const isValid = verifyMerkleMembership(
        root,
        attackerSecret,
        epoch,
        proof.pathElements,
        proof.pathIndices,
      );

      expect(isValid).toBe(false);
    });

    it("rejects proof evaluated against the wrong academic year epoch", () => {
      const tree = new StudentMembershipTree(TREE_DEPTH);
      const index = tree.insertStudent(secretA, epoch); // enrolled in 2026
      const root = tree.getRoot();
      const proof = tree.getProof(index);

      // Try proving with expired or different academic year
      const expiredEpoch = 2025;

      const isValid = verifyMerkleMembership(
        root,
        secretA,
        expiredEpoch,
        proof.pathElements,
        proof.pathIndices,
      );

      expect(isValid).toBe(false);
    });

    it("rejects invalid path lengths", () => {
      const tree = new StudentMembershipTree(TREE_DEPTH);
      const index = tree.insertStudent(secretA, epoch);
      const root = tree.getRoot();
      const proof = tree.getProof(index);

      const truncatedElements = proof.pathElements.slice(0, 10);
      const isValid = verifyMerkleMembership(
        root,
        secretA,
        epoch,
        truncatedElements,
        proof.pathIndices,
      );

      expect(isValid).toBe(false);
    });
  });

  describe("Active University Merkle Root verification", () => {
    it("recognizes default active campus roots for accredited universities", async () => {
      const mitRoot = DEFAULT_ACTIVE_CAMPUS_ROOTS.mit.root;
      const stanfordRoot = DEFAULT_ACTIVE_CAMPUS_ROOTS.stanford.root;
      const berkeleyRoot = DEFAULT_ACTIVE_CAMPUS_ROOTS.berkeley.root;

      expect(await isUniversityMerkleRootActive(mitRoot, 2026)).toBe(true);
      expect(await isUniversityMerkleRootActive(stanfordRoot, 2026)).toBe(true);
      expect(await isUniversityMerkleRootActive(berkeleyRoot, 2026)).toBe(true);
    });

    it("rejects unknown or forged university Merkle roots", async () => {
      const forgedRoot = "9999999999999999999999999999999999999999999999999999999999999999";
      expect(await isUniversityMerkleRootActive(forgedRoot, 2026)).toBe(false);
      expect(await isUniversityMerkleRootActive("", 2026)).toBe(false);
    });
  });

  describe("Groth16 Verifier with verification key", () => {
    it("rejects a proof when public signals are tampered", async () => {
      const mockProof = {
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

      const tamperedSignals = [
        "123456789012345678901234567890",
        "2026",
      ];

      const isValid = await verifyStudentMembershipProof(
        mockProof,
        tamperedSignals,
      );
      expect(isValid).toBe(false);
    });
  });
});
