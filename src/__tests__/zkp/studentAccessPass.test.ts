/**
 * @jest-environment node
 */
import {
  TREE_DEPTH,
  CURRENT_ACADEMIC_YEAR,
  computeStudentNullifierHash,
  StudentMembershipTree,
  verifyStudentAccessPassCredential,
  isUniversityMerkleRootActive,
  DEFAULT_ACTIVE_CAMPUS_ROOTS,
} from "@/lib/zkp/studentMembership";
import { poseidonHash } from "@/lib/zkp/poseidon";

describe("Anonymous Verifiable Credential for Student Access Passes (#3959)", () => {
  const studentSecret = 1234567890123456789n;
  const nullifierKey = 9876543210987654321n;
  const epoch = BigInt(CURRENT_ACADEMIC_YEAR);

  describe("Nullifier generation and anonymity properties", () => {
    it("derives deterministic nullifier hash Poseidon(secret, nullifierKey, epoch)", () => {
      const nullifier1 = computeStudentNullifierHash(studentSecret, nullifierKey, epoch);
      const nullifier2 = computeStudentNullifierHash(studentSecret, nullifierKey, epoch);

      expect(nullifier1).toBe(nullifier2);
      expect(nullifier1).toBe(poseidonHash([studentSecret, nullifierKey, epoch]));
    });

    it("generates distinct nullifier hashes across different users or epochs", () => {
      const otherSecret = 999888777666555444n;
      const otherEpoch = 2027n;

      const n1 = computeStudentNullifierHash(studentSecret, nullifierKey, epoch);
      const n2 = computeStudentNullifierHash(otherSecret, nullifierKey, epoch);
      const n3 = computeStudentNullifierHash(studentSecret, nullifierKey, otherEpoch);

      expect(n1).not.toBe(n2);
      expect(n1).not.toBe(n3);
    });
  });

  describe("Verifiable Credential Merkle verification with Nullifier", () => {
    it("successfully verifies proof of valid university signature and nullifier", () => {
      const tree = new StudentMembershipTree(TREE_DEPTH);
      const leafIndex = tree.insertStudent(studentSecret, epoch);
      const root = tree.getRoot();
      const proof = tree.getProof(leafIndex);

      const nullifierHash = computeStudentNullifierHash(studentSecret, nullifierKey, epoch);

      const isValid = verifyStudentAccessPassCredential(
        root,
        epoch,
        nullifierHash,
        studentSecret,
        nullifierKey,
        proof.pathElements,
        proof.pathIndices,
      );

      expect(isValid).toBe(true);
    });

    it("rejects verification when nullifier hash is forged or does not match secret", () => {
      const tree = new StudentMembershipTree(TREE_DEPTH);
      const leafIndex = tree.insertStudent(studentSecret, epoch);
      const root = tree.getRoot();
      const proof = tree.getProof(leafIndex);

      const forgedNullifierHash = 555555555555555555n;

      const isValid = verifyStudentAccessPassCredential(
        root,
        epoch,
        forgedNullifierHash,
        studentSecret,
        nullifierKey,
        proof.pathElements,
        proof.pathIndices,
      );

      expect(isValid).toBe(false);
    });

    it("rejects verification when secret is not enrolled in the university tree", () => {
      const tree = new StudentMembershipTree(TREE_DEPTH);
      // Enrolling a different student
      const enrolledSecret = 777777777777777777n;
      const leafIndex = tree.insertStudent(enrolledSecret, epoch);
      const root = tree.getRoot();
      const proof = tree.getProof(leafIndex);

      // Unenrolled student tries to use the proof
      const unenrolledSecret = studentSecret;
      const nullifierHash = computeStudentNullifierHash(unenrolledSecret, nullifierKey, epoch);

      const isValid = verifyStudentAccessPassCredential(
        root,
        epoch,
        nullifierHash,
        unenrolledSecret,
        nullifierKey,
        proof.pathElements,
        proof.pathIndices,
      );

      expect(isValid).toBe(false);
    });
  });

  describe("Active University validation", () => {
    it("accepts known accredited campus roots", async () => {
      const mitRoot = DEFAULT_ACTIVE_CAMPUS_ROOTS.mit.root;
      expect(await isUniversityMerkleRootActive(mitRoot, 2026)).toBe(true);
    });

    it("rejects inactive or forged roots", async () => {
      expect(await isUniversityMerkleRootActive("fake-root-123456", 2026)).toBe(false);
    });
  });
});
