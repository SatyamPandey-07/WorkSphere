import { resolveStudentVerificationKeyPath } from "@/lib/zkp/studentVerificationKey";

describe("resolveStudentVerificationKeyPath", () => {
  const paths = {
    legacy: "/zkp/verification_key.json",
    membership: "/zkp/student_membership_vkey.json",
    accessPass: "/zkp/student_access_pass_vkey.json",
  };
  const exists = (path: string) => path !== paths.accessPass;

  it("selects the one-signal legacy verification key", () => {
    expect(resolveStudentVerificationKeyPath(1, paths, exists)).toBe(paths.legacy);
  });

  it("selects the matching two-signal membership key", () => {
    expect(resolveStudentVerificationKeyPath(2, paths, exists)).toBe(paths.membership);
  });

  it("does not fall back to another circuit when the access-pass key is missing", () => {
    expect(resolveStudentVerificationKeyPath(3, paths, exists)).toBeNull();
  });

  it("rejects unsupported public signal counts", () => {
    expect(resolveStudentVerificationKeyPath(4, paths, exists)).toBeNull();
    expect(resolveStudentVerificationKeyPath(0, paths, exists)).toBeNull();
  });
});
