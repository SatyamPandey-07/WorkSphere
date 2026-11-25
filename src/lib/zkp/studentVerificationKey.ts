export interface StudentVerificationKeyPaths {
  legacy: string;
  membership: string;
  accessPass: string;
}

/**
 * Selects only the verification key whose circuit ABI matches the public
 * signal count. Returns null when the required artifact is missing.
 */
export function resolveStudentVerificationKeyPath(
  publicSignalCount: number,
  paths: StudentVerificationKeyPaths,
  exists: (path: string) => boolean,
): string | null {
  const candidate =
    publicSignalCount === 1
      ? paths.legacy
      : publicSignalCount === 2
        ? paths.membership
        : publicSignalCount === 3
          ? paths.accessPass
          : null;

  return candidate && exists(candidate) ? candidate : null;
}
