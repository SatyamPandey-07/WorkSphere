/**
 * Commitment binding used by circuits/premium_membership.circom
 * commit = token^2 + COMMIT_LINEAR * token + COMMIT_CONSTANT
 *
 * Only the commitment is ever public. The raw identity token stays on-device.
 */

const COMMIT_LINEAR = 5n;
const COMMIT_CONSTANT = 17n;

export function computeMembershipCommit(
  identityToken: string | number | bigint,
): string {
  const t = BigInt(identityToken);
  return (t * t + COMMIT_LINEAR * t + COMMIT_CONSTANT).toString();
}
